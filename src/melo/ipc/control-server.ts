import { chmodSync, existsSync, unlinkSync } from 'fs';
import { createConnection, createServer, type Server, type Socket } from 'net';
import type { ControlCommand } from '../../cli';
import { getControlIpcPath, isWindows } from '../../platform';
import { log, logError } from '../log';
import type { MeloEvent } from '../types';

const MAX_MESSAGE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface ControlResponse {
  ok: boolean;
  message: string;
  data?: unknown;
  request_id?: number;
}

export type ControlHandler = (command: ControlCommand) => Promise<ControlResponse> | ControlResponse;

export class ControlUnavailableError extends Error {
  constructor(message = 'No running MELO instance was found.') {
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

function validateCommand(raw: unknown): ControlCommand {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid control request.');
  const command = raw as { type?: unknown };
  if (typeof command.type !== 'string' || !command.type) throw new Error('Invalid control request.');
  return raw as ControlCommand;
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
        throw new Error('Another MELO instance is already running.');
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

    if (!isWindows) chmodSync(this.path, 0o600);
    log('ipc', `listening ${this.path}`);
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const socket of this.subscribers) {
      try { socket.end(); } catch {}
    }
    this.subscribers.clear();
    if (!server) return;
    await new Promise<void>(resolve => server.close(() => resolve()));
    cleanupSocketPath(this.path);
  }

  broadcast(event: MeloEvent): void {
    if (this.subscribers.size === 0) return;
    const message = JSON.stringify(event) + '\n';
    const dead: Socket[] = [];
    for (const socket of this.subscribers) {
      if (socket.destroyed) {
        dead.push(socket);
        continue;
      }
      try { socket.write(message); } catch { dead.push(socket); }
    }
    for (const socket of dead) this.subscribers.delete(socket);
  }

  private handleConnection(socket: Socket) {
    socket.setEncoding('utf8');
    let buffer = '';
    let handled = false;
    let isSubscriber = false;
    let lastRequestId: number | undefined;

    const respond = (response: ControlResponse) => {
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
      if (newline < 0 || handled) return;
      handled = true;

      try {
        const parsed = JSON.parse(buffer.slice(0, newline));
        lastRequestId = typeof parsed.request_id === 'number' ? parsed.request_id : undefined;
        const command = validateCommand(parsed);

        if (command.type === 'subscribe') {
          isSubscriber = true;
          this.subscribers.add(socket);
          if (!socket.destroyed) {
            socket.write(JSON.stringify({ ok: true, message: 'Subscribed to events.' }) + '\n');
          }
          return;
        }

        Promise.resolve(this.handler(command))
          .then(response => respond(response))
          .catch(error => {
            const msg = error instanceof Error ? error.message : String(error);
            logError('ipc', `handler error: ${msg}`);
            respond({ ok: false, message: msg });
          });
      } catch {
        respond({ ok: false, message: 'Invalid control request.' });
      }
    });

    socket.on('error', () => {});
    socket.on('close', () => {
      if (isSubscriber) this.subscribers.delete(socket);
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
      finish(isUnavailableError(error) ? new ControlUnavailableError() : error);
    });
    socket.once('close', () => {
      if (!settled) finish(new ControlUnavailableError('The running player closed the control connection.'));
    });
  });
}
