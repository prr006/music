/**
 * BackendManager — manages the lifecycle of the headless backend process.
 *
 * Lifecycle model:
 *   1. On start(), first probe the existing named pipe.
 *   2. If an existing backend responds to get-state → attach to it (we don't own it).
 *   3. If pipe is unavailable → spawn a new backend (we own it).
 *   4. Track ownership: only kill/restart processes we spawned.
 *   5. Prevent concurrent start/restart attempts with a state machine.
 */

import { app } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import { createConnection, type Socket } from 'net';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { join, dirname } from 'path';

// ─── Types ────────────────────────────────────────────────────────────────

export type ConnectionState = 'starting' | 'connecting' | 'connected' | 'disconnected' | 'error';

interface BackendResponse {
  ok: boolean;
  message: string;
  data?: unknown;
}

// ─── Constants ────────────────────────────────────────────────────────────

const MAX_RESTART_ATTEMPTS = 5;
const INITIAL_RESTART_DELAY_MS = 2000;
const MAX_RESTART_DELAY_MS = 30000;
const READY_POLL_INTERVAL_MS = 500;
const READY_TIMEOUT_MS = 30_000;
const COMMAND_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 5000;
const ATTACH_PROBE_TIMEOUT_MS = 3000;

const TAG = '[BACKEND-LIFECYCLE]';

function log(msg: string) {
  console.log(`${TAG} ${msg}`);
}

// ─── BackendManager ───────────────────────────────────────────────────────

export class BackendManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private eventSocket: Socket | null = null;
  private _state: ConnectionState = 'disconnected';
  private restartAttempts = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shuttingDown = false;
  private controlPipe = '';
  private starting = false;          // guard against concurrent starts
  private ownsProcess = false;       // did THIS GUI spawn the backend?

  get state(): ConnectionState {
    return this._state;
  }

  private setState(s: ConnectionState) {
    if (this._state === s) return;
    const prev = this._state;
    this._state = s;
    log(`State: ${prev} → ${s}`);
    this.emit('state', s);
  }

  // ─── Start: attach-or-spawn ─────────────────────────────────────────────

  async start(): Promise<void> {
    // Guard against concurrent starts
    if (this.starting) {
      log('start() called but already starting — skipping duplicate');
      return;
    }
    if (this.process) {
      log(`Backend already running (pid=${this.process.pid}, owns=${this.ownsProcess}) — skipping`);
      return;
    }

    this.starting = true;
    this.shuttingDown = false;
    this.setState('starting');
    this.controlPipe = this.computePipePath();
    log(`Control pipe: ${this.controlPipe}`);

    try {
      // Step 1: Probe existing pipe — can we attach?
      const attached = await this.tryAttachExisting();
      if (attached) {
        this.starting = false;
        return;  // successfully attached, no spawn needed
      }

      // Step 2: No existing backend — spawn one we own
      log('No existing backend found — spawning new process');
      this.spawnBackend();
      this.starting = false;
    } catch (err) {
      this.starting = false;
      log(`start() error: ${err}`);
      this.setState('error');
      this.emit('restart-failed');
    }
  }

  // ─── Probe existing pipe and attach if alive ─────────────────────────────

  private async tryAttachExisting(): Promise<boolean> {
    log('Probing existing backend on pipe...');
    try {
      // Try to send get-state to the existing pipe
      const response = await this.sendCommandOnPipe(this.controlPipe, { type: 'get-state' }, ATTACH_PROBE_TIMEOUT_MS);
      if (response.ok) {
        log(`Existing backend responded OK: "${response.message.substring(0, 80)}"`);
        log('Attaching to existing backend — we do NOT own it');

        // Subscribe to events from the existing backend
        this.setState('connecting');
        await this.subscribeEvents();
        this.setState('connected');
        this.ownsProcess = false;
        this.restartAttempts = 0;
        this.process = null;  // we didn't spawn it
        log('Successfully attached to existing backend');
        this.emit('connected');
        return true;
      }
      log('Existing backend responded but not OK — will spawn new');
      return false;
    } catch (err) {
      log(`Existing backend probe failed: ${(err as Error).message} — will spawn new`);
      return false;
    }
  }

  // ─── Spawn backend process (we own it) ──────────────────────────────────

  private spawnBackend(): void {
    let config: { command: string; args: string[]; cwd: string };
    try {
      config = this.getSpawnConfig();
    } catch (err) {
      log(`FATAL: Cannot determine spawn config: ${err}`);
      this.setState('error');
      this.emit('restart-failed');
      return;
    }

    log(`Spawn config: command=${config.command}, args=${JSON.stringify(config.args)}, cwd=${config.cwd}`);

    if (config.args.length === 0) {
      if (!existsSync(config.command)) {
        log(`FATAL: Backend binary not found at: ${config.command}`);
        this.setState('error');
        this.emit('restart-failed');
        return;
      }
    } else {
      const scriptPath = config.args[config.args.length - 1];
      if (!existsSync(scriptPath)) {
        log(`FATAL: Backend script not found at: ${scriptPath}`);
        this.setState('error');
        this.emit('restart-failed');
        return;
      }
    }

    const useShell = config.args.length > 0;
    log(`Spawning: shell=${useShell}`);

    const child = spawn(config.command, config.args, {
      cwd: config.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      shell: useShell,
      env: this.backendEnv(),
    });

    this.process = child;
    this.ownsProcess = true;
    log(`Backend spawned: pid=${child.pid} (owned by this GUI)`);

    child.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        const trimmed = line.trim();
        if (trimmed) {
          log(`[backend-stdout] ${trimmed}`);
          if (trimmed.includes('READY')) log('Detected READY signal from backend');
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        const trimmed = line.trim();
        if (trimmed) log(`[backend-stderr] ${trimmed}`);
      }
    });

    child.on('error', (err) => {
      log(`CRITICAL: Spawn error: ${err.message} (code=${(err as any).code})`);
      this.process = null;
      this.ownsProcess = false;
      this.setState('error');
      this.emit('error', err);
      this.scheduleRestart();
    });

    child.on('exit', (code, signal) => {
      log(`Process exited: code=${code}, signal=${signal}, pid=${child.pid}, owned=${this.ownsProcess}`);
      this.process = null;
      this.cleanupEventSocket();

      if (!this.shuttingDown) {
        this.setState('disconnected');
        this.emit('disconnected');
        if (code !== 0 && code !== null) {
          log(`Abnormal exit (code=${code}), scheduling restart`);
          this.scheduleRestart();
        }
      }
    });

    this.waitForReady(child);
  }

  // ─── Wait for backend readiness (assigned to a specific child) ───────────

  private async waitForReady(child: ChildProcess): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let attempt = 0;
    let lastError: Error | null = null;

    log(`Waiting for readiness (timeout=${READY_TIMEOUT_MS}ms)`);

    while (Date.now() < deadline) {
      attempt++;

      // If the child we're waiting for is no longer the current process, abort
      if (this.process !== child) {
        log('waitForReady: child reference changed — aborting');
        return;
      }

      try {
        log(`Readiness #${attempt}: probing pipe`);
        await this.tryConnect();
        log(`Readiness #${attempt}: pipe connected`);

        this.setState('connecting');
        await this.subscribeEvents();
        log('Event subscription OK');

        this.setState('connected');
        this.restartAttempts = 0;
        log(`Backend ready and connected (pid=${child.pid}, owned=${this.ownsProcess})`);
        this.emit('connected');
        return;
      } catch (err) {
        lastError = err as Error;
        if (attempt <= 3 || attempt % 10 === 0) {
          log(`Readiness #${attempt} failed: ${lastError.message}`);
        }
      }

      await this.sleep(READY_POLL_INTERVAL_MS);
    }

    log(`READINESS TIMEOUT after ${Date.now() - (deadline - READY_TIMEOUT_MS)}ms`);
    this.setState('error');
    if (this.process === child) {
      log('Killing owned backend after readiness timeout');
      this.process.kill();
    }
    this.emit('restart-failed');
  }

  // ─── Pipe path computation ──────────────────────────────────────────────

  private computePipePath(): string {
    const override = process.env.MELO_CONTROL_SOCKET?.trim();
    if (override) return override;

    const userId = process.env.USERNAME?.replace(/[^a-zA-Z0-9_-]/g, '_') || 'user';

    if (process.platform === 'win32') {
      return `\\\\.\\pipe\\melo-control-${userId}`;
    }
    return join(require('os').tmpdir(), `melo-control-${userId}.sock`);
  }

  // ─── Spawn config ───────────────────────────────────────────────────────

  private backendEnv(): NodeJS.ProcessEnv {
    const packaged = app.isPackaged;
    const bundled = process.env.MELO_BUNDLED_RUNTIME?.trim()
      || (packaged && process.resourcesPath
        ? join(process.resourcesPath, 'runtime')
        : this.devRuntimeDir());
    const userRuntime = process.env.MELO_USER_RUNTIME?.trim()
      || join(app.getPath('userData'), 'runtime');

    return {
      ...process.env,
      MELO_PACKAGED: packaged ? '1' : (process.env.MELO_PACKAGED || ''),
      MELO_BUNDLED_RUNTIME: bundled,
      MELO_USER_RUNTIME: userRuntime,
    };
  }

  private devRuntimeDir(): string {
    const root = this.findProjectRoot();
    if (root) return join(root, 'gui', 'resources', 'runtime');
    return join(process.resourcesPath || '', 'runtime');
  }

  private getSpawnConfig(): { command: string; args: string[]; cwd: string } {
    const packagedPath = process.resourcesPath
      ? join(process.resourcesPath, 'backend-headless.exe')
      : null;

    if (packagedPath && existsSync(packagedPath)) {
      log(`Packaged backend: ${packagedPath}`);
      return { command: packagedPath, args: [], cwd: process.resourcesPath! };
    }

    const projectRoot = this.findProjectRoot();
    if (projectRoot) {
      const scriptPath = join(projectRoot, 'src', 'backend-headless.ts');
      log(`Dev mode: root=${projectRoot}, script=${scriptPath}`);
      return { command: 'bun', args: ['run', scriptPath], cwd: projectRoot };
    }

    throw new Error('Cannot locate project root for backend startup');
  }

  private findProjectRoot(): string | null {
    let dir = process.cwd();
    for (let i = 0; i < 5; i++) {
      if (existsSync(join(dir, 'src', 'backend-headless.ts'))) return dir;
      if (existsSync(join(dir, 'src', 'index.ts'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  // ─── Pipe connection (readiness probe) ──────────────────────────────────

  private tryConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.controlPipe);
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve();
      };

      const timer = setTimeout(() => finish(new Error(`Pipe connection timed out after ${CONNECT_TIMEOUT_MS}ms`)), CONNECT_TIMEOUT_MS);

      socket.once('connect', () => { log(`Pipe connected: ${this.controlPipe}`); finish(); });
      socket.once('error', (err: Error) => finish(err));
    });
  }

  // ─── Event subscription ─────────────────────────────────────────────────

  private async subscribeEvents(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.eventSocket) { resolve(); return; }

      const socket = createConnection(this.controlPipe);
      let subscribed = false;
      const timer = setTimeout(() => {
        if (!subscribed) { socket.destroy(); reject(new Error('Subscribe timed out')); }
      }, 5000);

      socket.on('connect', () => {
        log(`Subscribe: sending subscribe to ${this.controlPipe}`);
        socket.write(JSON.stringify({ type: 'subscribe' }) + '\n');
      });

      let eventBuffer = '';
      socket.on('data', (chunk: Buffer) => {
        const raw = chunk.toString();
        if (!subscribed) {
          subscribed = true;
          clearTimeout(timer);
          this.eventSocket = socket;
          log('Subscribe: confirmed');
          resolve();
        }
        eventBuffer += raw;
        const lines = eventBuffer.split('\n');
        eventBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg && typeof msg.type === 'string') this.emit('event', msg);
          } catch {}
        }
      });

      socket.on('error', (err: Error) => {
        log(`Subscribe: error: ${err.message}`);
        if (!subscribed) { clearTimeout(timer); reject(err); }
        else { this.cleanupEventSocket(); this.scheduleReconnect(); }
      });

      socket.on('close', () => {
        if (!subscribed) { clearTimeout(timer); reject(new Error('Subscribe socket closed')); }
        else {
          this.cleanupEventSocket();
          if (this._state === 'connected') {
            this.setState('disconnected');
            this.emit('disconnected');
            this.scheduleReconnect();
          }
        }
      });
    });
  }

  // ─── Reconnect: probe first, re-attach or restart ───────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.shuttingDown) return;
    log('Scheduling reconnect in 3s...');
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.shuttingDown) { log('Reconnect skipped: shutting down'); return; }

      // Probe the pipe — is the backend still alive?
      try {
        const r = await this.sendCommandOnPipe(this.controlPipe, { type: 'get-state' }, ATTACH_PROBE_TIMEOUT_MS);
        if (r.ok) {
          log('Reconnect: backend still alive on pipe — re-attaching');
          try {
            this.setState('connecting');
            await this.subscribeEvents();
            this.setState('connected');
            log('Re-attached to existing backend');
            this.emit('connected');
            return;
          } catch (err) {
            log(`Reconnect: re-attach failed: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        log(`Reconnect: probe failed: ${(err as Error).message}`);
      }

      // Backend is gone — if we own it, restart; otherwise, try start() which will probe+spawn
      if (this.ownsProcess) {
        log('Reconnect: owned backend is dead — scheduling restart');
        this.scheduleRestart();
      } else {
        log('Reconnect: external backend is gone — starting fresh');
        this.start();
      }
    }, 3000);
  }

  private cleanupEventSocket(): void {
    if (this.eventSocket) {
      log('Cleaning up event socket');
      try { this.eventSocket.destroy(); } catch {}
      this.eventSocket = null;
    }
  }

  // ─── Send command on arbitrary pipe (used for attach probe) ──────────────

  private async sendCommandOnPipe(pipePath: string, command: Record<string, unknown>, timeoutMs: number): Promise<BackendResponse> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(pipePath);
      let buffer = '';
      let settled = false;

      const finish = (error?: Error, response?: BackendResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        if (error) reject(error);
        else resolve(response!);
      };

      const timeout = setTimeout(() => finish(new Error('Probe timed out')), timeoutMs);

      socket.on('connect', () => {
        socket.write(JSON.stringify({ ...command, request_id: Date.now() }) + '\n');
      });
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const nl = buffer.indexOf('\n');
        if (nl < 0) return;
        try { finish(undefined, JSON.parse(buffer.slice(0, nl)) as BackendResponse); }
        catch { finish(new Error('Invalid response')); }
      });
      socket.on('error', (e: Error) => finish(e));
      socket.on('close', () => { if (!settled) finish(new Error('Connection closed')); });
    });
  }

  // ─── Send command (for renderer IPC) ────────────────────────────────────

  async sendCommand(command: Record<string, unknown>): Promise<BackendResponse> {
    return this.sendCommandOnPipe(this.controlPipe, command, COMMAND_TIMEOUT_MS);
  }

  // ─── Restart ────────────────────────────────────────────────────────────

  private scheduleRestart(): void {
    if (this.restartTimer || this.shuttingDown) return;

    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      log(`FAILED to restart after ${MAX_RESTART_ATTEMPTS} attempts`);
      this.setState('error');
      this.emit('restart-failed');
      return;
    }

    const delay = Math.min(INITIAL_RESTART_DELAY_MS * Math.pow(2, this.restartAttempts), MAX_RESTART_DELAY_MS);
    this.restartAttempts++;

    log(`Restart in ${delay}ms (attempt ${this.restartAttempts}/${MAX_RESTART_ATTEMPTS})`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();  // start() will probe existing pipe first
    }, delay);
  }

  // ─── Shutdown ───────────────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    log(`Shutdown: owns=${this.ownsProcess}, hasProcess=${!!this.process}`);

    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }

    this.cleanupEventSocket();

    if (this.ownsProcess && this.process) {
      log(`Shutdown: sending quit to owned backend (pid=${this.process.pid})`);
      try {
        await this.sendCommand({ type: 'quit' });
        log('Quit sent, waiting 2s');
        await this.sleep(2000);
      } catch (err) {
        log(`Quit failed: ${(err as Error).message}`);
      }

      if (this.process) {
        log(`Force-killing owned backend (pid=${this.process.pid})`);
        try { this.process.kill(); } catch {}
        await this.sleep(500);
        if (this.process) {
          try { this.process.kill('SIGKILL'); } catch {}
        }
        this.process = null;
      }
    } else if (!this.ownsProcess) {
      log('Shutdown: backend is externally owned — NOT killing it');
    }

    this.ownsProcess = false;
    this.setState('disconnected');
    log('Shutdown complete');
  }

  // ─── Utilities ──────────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
