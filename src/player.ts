import { createConnection, type Socket } from 'net';
import { EventEmitter } from 'events';
import { unlinkSync } from 'fs';
import { getMpvIpcPath, isWindows, resolveCommand } from './platform';
import { getMpvPrivacyArgs } from './privacy';

export interface PlayerState {
  title: string;
  paused: boolean;
  muted: boolean;
  timePos: number;
  duration: number;
  volume: number;
  repeatMode: 'off' | 'one' | 'all';
}

interface PendingRequest {
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const MPV_REQUEST_TIMEOUT_MS = 5000;

export class Player extends EventEmitter {
  private readonly ipcPath = getMpvIpcPath();
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private socket: Socket | null = null;
  private buf = '';
  private reqId = 0;
  private pending = new Map<number, PendingRequest>();
  private mpvStderr = '';

  state: PlayerState = {
    title: '',
    paused: false,
    muted: false,
    timePos: 0,
    duration: 0,
    volume: 100,
    repeatMode: 'off',
  };

  async start() {
    this.cleanupIpcPath();
    this.mpvStderr = '';
    const mpv = resolveCommand('mpv') ?? 'mpv';

    this.proc = Bun.spawn(
      [mpv, ...getMpvPrivacyArgs(), '--no-video', '--no-terminal', `--input-ipc-server=${this.ipcPath}`, '--idle=yes'],
      { stderr: 'pipe', stdout: 'ignore' }
    );
    const stderr = this.proc.stderr;
    if (stderr && typeof stderr !== 'number') {
      void this.captureStderr(stderr);
    }

    try {
      await this.connect();
      await this.observe();
    } catch (error) {
      this.stopTransport(new Error('mpv failed during startup.'));
      this.cleanupIpcPath();
      throw error;
    }
  }

  private async captureStderr(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        this.mpvStderr += decoder.decode(value, { stream: true });
        if (this.mpvStderr.length > 4000) {
          this.mpvStderr = this.mpvStderr.slice(-4000);
        }
      }
    } catch {}
  }

  private cleanupIpcPath() {
    if (isWindows) return;

    try {
      unlinkSync(this.ipcPath);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
      if (code !== 'ENOENT') throw error;
    }
  }

  private async connect(timeout = 15000): Promise<void> {
    const deadline = Date.now() + timeout;
    let lastError: unknown;

    while (Date.now() < deadline) {
      try {
        await this.connectOnce();
        return;
      } catch (error) {
        lastError = error;
      }

      const exitCode = this.proc?.exitCode;
      if (exitCode !== null && exitCode !== undefined) break;
      await Bun.sleep(50);
    }

    const connectionDetail = lastError instanceof Error ? ` Last connection error: ${lastError.message}.` : '';
    const exitCode = this.proc?.exitCode;
    const exitDetail = exitCode !== null && exitCode !== undefined ? ` mpv exited with code ${exitCode}.` : '';
    const stderr = this.mpvStderr.trim();
    const stderrDetail = stderr ? ` mpv error: ${stderr}` : '';
    throw new Error(
      `mpv IPC endpoint did not become ready within ${timeout}ms: ${this.ipcPath}.${exitDetail}${connectionDetail}${stderrDetail}`
    );
  }

  private connectOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.ipcPath);
      const fail = (error: Error) => {
        socket.destroy();
        reject(error);
      };

      socket.once('error', fail);
      socket.once('connect', () => {
        socket.off('error', fail);
        socket.on('error', (error) => this.rejectPending(error));
        socket.on('close', () => {
          if (this.socket === socket) this.socket = null;
          this.rejectPending(new Error('mpv IPC connection closed.'));
        });
        socket.on('data', (d) => this.onData(d.toString()));
        this.socket = socket;
        resolve();
      });
    });
  }

  private async observe() {
    await this.send('observe_property', 1, 'media-title');
    await this.send('observe_property', 2, 'pause');
    await this.send('observe_property', 3, 'time-pos');
    await this.send('observe_property', 4, 'duration');
    await this.send('observe_property', 5, 'volume');
    await this.send('observe_property', 6, 'mute');
  }

  private onData(data: string) {
    this.buf += data;
    const lines = this.buf.split('\n');
    this.buf = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);

        if (msg.request_id !== undefined) {
          const pending = this.pending.get(msg.request_id);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pending.delete(msg.request_id);
            if (msg.error && msg.error !== 'success') {
              pending.reject(new Error(`mpv command failed: ${msg.error}`));
            } else {
              pending.resolve(msg);
            }
          }
        }

        if (msg.event === 'property-change') {
          this.onPropChange(msg.name, msg.data);
        } else if (msg.event === 'end-file') {
          this.emit('end-file', msg);
        } else if (msg.event === 'start-file') {
          this.emit('start-file');
        }
      } catch {}
    }
  }

  private onPropChange(name: string, value: any) {
    if (value == null) return;
    switch (name) {
      case 'media-title': this.state.title = value; break;
      case 'pause': this.state.paused = value; break;
      case 'mute': this.state.muted = value; break;
      case 'time-pos': this.state.timePos = value; break;
      case 'duration': this.state.duration = value; break;
      case 'volume': this.state.volume = Math.round(value); break;
    }
    this.emit('state');
  }

  private send(...args: any[]): Promise<any> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      return Promise.reject(new Error('mpv IPC connection is not available.'));
    }

    return new Promise((resolve, reject) => {
      const id = ++this.reqId;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mpv command timed out after ${MPV_REQUEST_TIMEOUT_MS}ms.`));
      }, MPV_REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeout });

      try {
        socket.write(JSON.stringify({ command: args, request_id: id }) + '\n');
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private rejectPending(error: Error) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }

  private stopTransport(error: Error) {
    this.rejectPending(error);
    const socket = this.socket;
    this.socket = null;
    socket?.destroy();

    if (this.proc) {
      try { this.proc.kill(); } catch {}
      this.proc = null;
    }
  }

  async loadTrack(url: string) {
    await this.send('loadfile', url, 'replace');
  }

  async togglePause() {
    await this.send('cycle', 'pause');
    const result = await this.send('get_property', 'pause');
    this.state.paused = Boolean(result?.data);
  }

  async setPaused(paused: boolean) {
    await this.send('set_property', 'pause', paused);
    this.state.paused = paused;
  }

  async toggleMute() {
    await this.send('cycle', 'mute');
    const result = await this.send('get_property', 'mute');
    this.state.muted = Boolean(result?.data);
  }
  async seek(secs: number) { await this.send('seek', secs, 'relative'); }
  async stop() { await this.send('stop'); }

  async quit() {
    try { await this.send('quit'); } catch {}
    this.stopTransport(new Error('Player stopped.'));
    this.cleanupIpcPath();
  }

  async setVolume(level: number) {
    const clamped = Math.max(0, Math.min(100, level));
    await this.send('set_property', 'volume', clamped);
    this.state.volume = clamped;
  }

  async getVolume() {
    const result = await this.send('get_property', 'volume');
    return result?.data ?? 100;
  }
  
  async setRepeatMode(mode: 'off' | 'one' | 'all') {
    this.state.repeatMode = mode;
    if (mode === 'one') {
      await this.send('set_property', 'loop-file', 'inf');
      await this.send('set_property', 'loop-playlist', 'no');
    } else if (mode === 'all') {
      await this.send('set_property', 'loop-file', 'no');
      await this.send('set_property', 'loop-playlist', 'inf');
    } else {
      await this.send('set_property', 'loop-file', 'no');
      await this.send('set_property', 'loop-playlist', 'no');
    }
    this.emit('state');
  }
}
