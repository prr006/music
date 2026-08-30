import { createConnection, type Socket } from 'net';
import { EventEmitter } from 'events';
import { unlinkSync } from 'fs';
import { delimiter, dirname } from 'path';
import { getMpvIpcPath, isWindows } from '../../platform';
import { getMpvPrivacyArgs } from '../../privacy';
import { log, logError } from '../log';
import { requireRuntimeBinary, resolveRuntimeBinary } from '../runtime/binaries';
import type { PlaybackDriver, PlaybackSnapshot, RepeatMode } from '../types';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 5000;

export class MpvPlayer extends EventEmitter implements PlaybackDriver {
  private readonly ipcPath = getMpvIpcPath();
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private socket: Socket | null = null;
  private buffer = '';
  private requestId = 0;
  private pending = new Map<number, Pending>();
  private stderrTail = '';

  snapshot: PlaybackSnapshot = {
    paused: false,
    muted: false,
    timePos: 0,
    duration: 0,
    volume: 100,
    repeatMode: 'off',
  };

  async start(): Promise<void> {
    this.cleanupSocketFile();
    const mpv = requireRuntimeBinary('mpv');
    const ytdlp = resolveRuntimeBinary('yt-dlp');
    const args = [...getMpvPrivacyArgs()];
    if (ytdlp) args.push(`--script-opts=ytdl_hook-ytdl_path=${ytdlp.replace(/\\/g, '/')}`);
    args.push('--no-video', '--no-terminal', `--input-ipc-server=${this.ipcPath}`, '--idle=yes');
    log('playback', `starting mpv ipc=${this.ipcPath}`);

    const env = { ...process.env };
    if (isWindows) {
      env.PATH = `${dirname(mpv)}${delimiter}${env.PATH || env.Path || ''}`;
    }

    this.proc = Bun.spawn([mpv, ...args], {
      stderr: 'pipe',
      stdout: 'ignore',
      env,
    });
    if (this.proc.stderr && typeof this.proc.stderr !== 'number') {
      void this.captureStderr(this.proc.stderr);
    }

    this.proc.exited.then(code => {
      if (this.proc) {
        logError('playback', `mpv exited unexpectedly code=${code}`);
        this.emit('unexpected-exit', new Error(`mpv exited with code ${code}`));
      }
    }).catch(() => {});

    try {
      await this.connect();
      await this.observe();
    } catch (error) {
      this.teardown(new Error('mpv failed during startup.'));
      this.cleanupSocketFile();
      throw error;
    }
  }

  async quit(): Promise<void> {
    try { await this.command('quit'); } catch {}
    this.teardown(new Error('Player stopped.'));
    this.cleanupSocketFile();
  }

  async load(url: string): Promise<void> {
    await this.command('loadfile', url, 'replace');
  }

  async togglePause(): Promise<void> {
    await this.command('cycle', 'pause');
    const result = await this.command('get_property', 'pause') as { data?: boolean };
    this.snapshot.paused = Boolean(result?.data);
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.command('set_property', 'pause', paused);
    this.snapshot.paused = paused;
  }

  async toggleMute(): Promise<boolean> {
    await this.command('cycle', 'mute');
    const result = await this.command('get_property', 'mute') as { data?: boolean };
    this.snapshot.muted = Boolean(result?.data);
    return this.snapshot.muted;
  }

  async seek(seconds: number): Promise<void> {
    await this.command('seek', seconds, 'relative');
  }

  async stop(): Promise<void> {
    await this.command('stop');
  }

  async setVolume(level: number): Promise<number> {
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    await this.command('set_property', 'volume', clamped);
    this.snapshot.volume = clamped;
    return clamped;
  }

  async getVolume(): Promise<number> {
    const result = await this.command('get_property', 'volume') as { data?: number };
    return result?.data ?? this.snapshot.volume;
  }

  async setRepeatMode(mode: RepeatMode): Promise<void> {
    this.snapshot.repeatMode = mode;
    if (mode === 'one') {
      await this.command('set_property', 'loop-file', 'inf');
      await this.command('set_property', 'loop-playlist', 'no');
    } else {
      await this.command('set_property', 'loop-file', 'no');
      await this.command('set_property', 'loop-playlist', 'no');
    }
    this.emit('state');
  }

  private async observe(): Promise<void> {
    await this.command('observe_property', 1, 'pause');
    await this.command('observe_property', 2, 'time-pos');
    await this.command('observe_property', 3, 'duration');
    await this.command('observe_property', 4, 'volume');
    await this.command('observe_property', 5, 'mute');
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
      if (this.proc?.exitCode !== null && this.proc?.exitCode !== undefined) break;
      await Bun.sleep(50);
    }

    const extra = lastError instanceof Error ? lastError.message : '';
    throw new Error(`mpv IPC did not become ready: ${this.ipcPath}. ${extra} ${this.stderrTail}`.trim());
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
        socket.on('error', error => this.rejectAll(error));
        socket.on('close', () => {
          if (this.socket === socket) this.socket = null;
          this.rejectAll(new Error('mpv IPC connection closed.'));
        });
        socket.on('data', data => this.onData(data.toString()));
        this.socket = socket;
        resolve();
      });
    });
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (msg.request_id !== undefined) {
        const pending = this.pending.get(msg.request_id as number);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(msg.request_id as number);
          if (msg.error && msg.error !== 'success') {
            pending.reject(new Error(`mpv command failed: ${String(msg.error)}`));
          } else {
            pending.resolve(msg);
          }
        }
      }

      if (msg.event === 'property-change') {
        this.onProperty(String(msg.name), msg.data);
      } else if (msg.event === 'end-file') {
        this.emit('end-file', { reason: String(msg.reason ?? '') });
      }
    }
  }

  private onProperty(name: string, value: unknown) {
    if (value == null) return;
    switch (name) {
      case 'pause': this.snapshot.paused = Boolean(value); break;
      case 'mute': this.snapshot.muted = Boolean(value); break;
      case 'time-pos': this.snapshot.timePos = Number(value) || 0; break;
      case 'duration': this.snapshot.duration = Number(value) || 0; break;
      case 'volume': this.snapshot.volume = Math.round(Number(value) || 0); break;
    }
    this.emit('state');
  }

  async command(...args: unknown[]): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      throw new Error('mpv IPC connection is not available.');
    }

    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mpv command timed out after ${REQUEST_TIMEOUT_MS}ms.`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        socket.write(JSON.stringify({ command: args, request_id: id }) + '\n');
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private teardown(error: Error) {
    this.rejectAll(error);
    const socket = this.socket;
    this.socket = null;
    socket?.destroy();
    if (this.proc) {
      try { this.proc.kill(); } catch {}
      this.proc = null;
    }
  }

  private cleanupSocketFile() {
    if (isWindows) return;
    try { unlinkSync(this.ipcPath); } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
      if (code !== 'ENOENT') throw error;
    }
  }

  private async captureStderr(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.stderrTail += decoder.decode(value, { stream: true });
        if (this.stderrTail.length > 4000) this.stderrTail = this.stderrTail.slice(-4000);
      }
    } catch {}
  }
}
