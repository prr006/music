import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ControlServer, ControlUnavailableError, sendControlCommand } from '../src/control';
import type { ControlCommand } from '../src/cli';

async function withSocketPath(run: (path: string) => Promise<void>) {
  if (process.platform === 'win32') {
    await run(`\\\\.\\pipe\\ytmusic-player-control-test-${process.pid}-${Date.now()}`);
    return;
  }

  const directory = await mkdtemp(join(tmpdir(), 'ytmusic-player-control-test-'));
  try {
    await run(join(directory, 'control.sock'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('player control socket', () => {
  test('sends a command and receives its response', async () => {
    await withSocketPath(async path => {
      const received: ControlCommand[] = [];
      const server = new ControlServer(command => {
        received.push(command);
        return { ok: true, message: 'Paused.' };
      }, path);

      await server.start();
      try {
        await expect(sendControlCommand({ type: 'pause' }, { path, timeout: 1000 }))
          .resolves.toEqual({ ok: true, message: 'Paused.' });
        expect(received).toEqual([{ type: 'pause' }]);
        if (process.platform !== 'win32') {
          expect((await stat(path)).mode & 0o777).toBe(0o600);
        }
      } finally {
        await server.stop();
      }
    });
  });

  test('replaces a stale Unix socket path', async () => {
    if (process.platform === 'win32') return;
    await withSocketPath(async path => {
      await writeFile(path, 'stale');
      const server = new ControlServer(() => ({ ok: true, message: 'ready' }), path);
      await server.start();
      try {
        await expect(sendControlCommand({ type: 'status' }, { path, timeout: 1000 }))
          .resolves.toEqual({ ok: true, message: 'ready' });
      } finally {
        await server.stop();
      }
    });
  });

  test('does not replace an active player socket', async () => {
    await withSocketPath(async path => {
      const first = new ControlServer(() => ({ ok: true, message: 'first' }), path);
      const second = new ControlServer(() => ({ ok: true, message: 'second' }), path);
      await first.start();
      try {
        await expect(second.start()).rejects.toThrow('already running');
      } finally {
        await first.stop();
      }
    });
  });

  test('reports a missing player distinctly', async () => {
    await withSocketPath(async path => {
      await expect(sendControlCommand({ type: 'status' }, { path, timeout: 100 }))
        .rejects.toBeInstanceOf(ControlUnavailableError);
    });
  });
});
