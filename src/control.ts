import { chmodSync, existsSync, unlinkSync } from 'fs';
import { createConnection, createServer, type Server, type Socket } from 'net';
import type { ControlCommand } from './cli';
import type { EngineEvent } from './engine';
import { getControlIpcPath, isWindows } from './platform';

const MAX_MESSAGE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface ControlResponse {
  ok: boolean;
  message: string;
}

/** Extended response that can carry structured JSON data. */
export interface ControlDataResponse extends ControlResponse {
  data?: unknown;
}

export type ControlHandler = (command: ControlCommand) => Promise<ControlResponse | ControlDataResponse> | ControlResponse | ControlDataResponse;

export class ControlUnavailableError extends Error {
  constructor(message = 'No running ytmusic-player instance was found.') {
    super(message);
    this.name = 'ControlUnavailableError';
  }
}

function cleanupSocketPath(path: string) {
  if (isWindows) return;
  try {
    unlinkSync(path);
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error
      ? (error as { code?: string }).code
      : undefined;
    if (code !== 'ENOENT') throw error;
  }
}

function isUnavailableError(error: unknown): boolean {
  const code = typeof error === 'object' && error && 'code' in error
    ? (error as { code?: string }).code
    : undefined;
  return code === 'ENOENT' || code === 'ECONNREFUSED' || code === 'EPIPE';
}

function canConnect(path: string, timeout = 250): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection(path);
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(available);
    };
    const timer = setTimeout(() => finish(false), timeout);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export class ControlServer {
  private server: Server | null = null;
  private subscribers = new Set<Socket>();

  constructor(
    private readonly handler: ControlHandler,
    readonly path = getControlIpcPath(),
  ) {}

  async start(): Promise<void> {
    if (this.server) return;

    if (!isWindows && existsSync(this.path)) {
      if (await canConnect(this.path)) {
        throw new Error('Another ytmusic-player instance is already running.');
      }
      cleanupSocketPath(this.path);
    }

    const server = createServer(socket => this.handleConnection(socket));
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        this.server = null;
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.path);
    });

    if (!isWindows) {
      chmodSync(this.path, 0o600);
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;

    // Close all subscriber connections
    for (const socket of this.subscribers) {
      try { socket.end(); } catch {}
    }
    this.subscribers.clear();

    if (!server) return;
    await new Promise<void>(resolve => server.close(() => resolve()));
    cleanupSocketPath(this.path);
  }

  /**
   * Broadcast an event to all subscribed clients.
   * Non-subscriber clients are unaffected.
   */
  broadcast(event: EngineEvent): void {
    if (this.subscribers.size === 0) return;        const message = JSON.stringify(event) + '\n';
    const dead: Socket[] = [];
    for (const socket of this.subscribers) {
      if (socket.destroyed) {
        dead.push(socket);
        continue;
      }
      try { socket.write(message); } catch { dead.push(socket); }
    }
    for (const socket of dead) {
      this.subscribers.delete(socket);
    }
  }

  private handleConnection(socket: Socket) {
    socket.setEncoding('utf8');
    let buffer = '';
    let handled = false;
    let isSubscriber = false;
    let lastRequestId: number | undefined;

    const respond = (response: ControlResponse | ControlDataResponse) => {
      if (socket.destroyed) return;
      const payload = lastRequestId !== undefined
        ? { ...response, request_id: lastRequestId }
        : response;
      socket.end(`${JSON.stringify(payload)}\n`);
    };

    socket.on('data', chunk => {
      buffer += chunk;

      if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) {
        if (!handled) {
          handled = true;
          respond({ ok: false, message: 'Control request is too large.' });
        }
        return;
      }

      const newline = buffer.indexOf('\n');
      if (newline < 0) return;

      if (handled) return; // already handled, ignore further input
      handled = true;

      try {
        const rawJson = buffer.slice(0, newline);
        const command = JSON.parse(rawJson);
        lastRequestId = (command as any).request_id;
        const typedCommand = command as ControlCommand;

        console.log('[DEBUG-CMD] backend received raw JSON:', rawJson);
        console.log('[DEBUG-CMD] backend parsed command.type:', typedCommand.type);

        // Handle subscribe command specially: keep connection open and add to subscribers
        if (typedCommand.type === 'subscribe') {
          isSubscriber = true;
          this.subscribers.add(socket);
          // Write response but do NOT end the socket — keep it alive for events
          if (!socket.destroyed) {
            socket.write(JSON.stringify({ ok: true, message: 'Subscribed to events.' }) + '\n');
          }
          return;
        }

        Promise.resolve(this.handler(typedCommand))
          .then(response => {
            console.log('[DEBUG-CMD] backend handler returned:', JSON.stringify({ ok: response.ok, message: response.message }));
            respond(response);
          })
          .catch(error => {
            const msg = error instanceof Error ? error.message : String(error);
            console.log('[DEBUG-CMD] backend handler ERROR:', msg);
            respond({ ok: false, message: msg });
          });
      } catch {
        console.log('[DEBUG-CMD] backend JSON parse failed for:', buffer.slice(0, newline));
        respond({ ok: false, message: 'Invalid control request.' });
      }
    });

    socket.on('error', () => {});

    socket.on('close', () => {
      if (isSubscriber) {
        this.subscribers.delete(socket);
      }
    });
  }
}

export function sendControlCommand(
  command: ControlCommand,
  options: { path?: string; timeout?: number } = {},
): Promise<ControlResponse> {
  const path = options.path || getControlIpcPath();
  const timeout = options.timeout || DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let buffer = '';
    let settled = false;

    const finish = (error?: Error, response?: ControlResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(response!);
    };

    const timer = setTimeout(() => {
      finish(new Error(`The running player did not respond within ${timeout}ms.`));
    }, timeout);

    socket.once('connect', () => {
      socket.write(`${JSON.stringify(command)}\n`);
    });
    socket.on('data', chunk => {
      buffer += chunk.toString();
      if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) {
        finish(new Error('Control response is too large.'));
        return;
      }

      const newline = buffer.indexOf('\n');
      if (newline < 0) return;

      try {
        finish(undefined, JSON.parse(buffer.slice(0, newline)) as ControlResponse);
      } catch {
        finish(new Error('The running player returned an invalid response.'));
      }
    });
    socket.once('error', error => {
      finish(isUnavailableError(error)
        ? new ControlUnavailableError()
        : error);
    });
    socket.once('close', () => {
      if (!settled) finish(new ControlUnavailableError('The running player closed the control connection.'));
    });
  });
}
