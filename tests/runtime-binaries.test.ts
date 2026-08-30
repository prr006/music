import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import {
  PACKAGED_MISSING_MESSAGE,
  getMissingRuntimeBinaries,
  requireRuntimeBinary,
  resolveRuntimeBinary,
} from '../src/melo/runtime/binaries';
import { probeBinaryVersion } from '../src/melo/runtime/versions';
import { ensureRuntimeDependencies } from '../src/dependencies';
import { assertSha256, sha256Buffer } from '../scripts/fetch-desktop-runtime';

function opts(env: Record<string, string>, files: string[], pathMap: Record<string, string | null> = {}) {
  const fileSet = new Set(files);
  return {
    env,
    platform: 'win32' as const,
    isFile: (path: string) => fileSet.has(path),
    resolveOnPath: (command: string) => pathMap[command] ?? null,
  };
}

describe('runtime resolution', () => {
  test('prefers MELO_YTDLP / MELO_MPV overrides', () => {
    const ytdlp = 'C:/override/yt-dlp.exe';
    const mpv = 'C:/override/mpv.exe';
    const options = opts({
      MELO_YTDLP: ytdlp,
      MELO_MPV: mpv,
      MELO_USER_RUNTIME: 'C:/user/runtime',
      MELO_BUNDLED_RUNTIME: 'C:/bundled/runtime',
    }, [ytdlp, mpv, 'C:/user/runtime/yt-dlp.exe', 'C:/bundled/runtime/mpv/mpv.exe']);

    expect(resolveRuntimeBinary('yt-dlp', options)).toBe(ytdlp);
    expect(resolveRuntimeBinary('mpv', options)).toBe(mpv);
  });

  test('uses the user overlay before bundled files', () => {
    const user = 'C:/user/runtime';
    const bundled = 'C:/bundled/runtime';
    const options = opts({
      MELO_USER_RUNTIME: user,
      MELO_BUNDLED_RUNTIME: bundled,
    }, [
      join(user, 'yt-dlp.exe'),
      join(user, 'mpv', 'mpv.exe'),
      join(bundled, 'yt-dlp.exe'),
      join(bundled, 'mpv', 'mpv.exe'),
    ]);

    expect(resolveRuntimeBinary('yt-dlp', options)).toBe(join(user, 'yt-dlp.exe'));
    expect(resolveRuntimeBinary('mpv', options)).toBe(join(user, 'mpv', 'mpv.exe'));
  });

  test('uses bundled runtime when the overlay is empty', () => {
    const bundled = 'C:/bundled/runtime';
    const options = opts({
      MELO_USER_RUNTIME: 'C:/user/runtime',
      MELO_BUNDLED_RUNTIME: bundled,
      MELO_PACKAGED: '1',
    }, [join(bundled, 'yt-dlp.exe'), join(bundled, 'mpv.exe')]);

    expect(resolveRuntimeBinary('yt-dlp', options)).toBe(join(bundled, 'yt-dlp.exe'));
    expect(resolveRuntimeBinary('mpv', options)).toBe(join(bundled, 'mpv.exe'));
  });

  test('development PATH is the last fallback', () => {
    const options = opts({}, [], { 'yt-dlp': '/usr/bin/yt-dlp', mpv: '/usr/bin/mpv' });
    expect(resolveRuntimeBinary('yt-dlp', options)).toBe('/usr/bin/yt-dlp');
    expect(resolveRuntimeBinary('mpv', options)).toBe('/usr/bin/mpv');
  });

  test('packaged mode never falls back to PATH', () => {
    const options = opts(
      { MELO_PACKAGED: '1', MELO_BUNDLED_RUNTIME: 'C:/bundled/runtime' },
      [],
      { 'yt-dlp': '/usr/bin/yt-dlp', mpv: '/usr/bin/mpv' },
    );
    expect(resolveRuntimeBinary('yt-dlp', options)).toBeNull();
    expect(resolveRuntimeBinary('mpv', options)).toBeNull();
    expect(getMissingRuntimeBinaries(options)).toEqual(['mpv', 'yt-dlp']);
  });

  test('requireRuntimeBinary explains a packaged reinstall', () => {
    const options = opts({ MELO_PACKAGED: '1' }, []);
    expect(() => requireRuntimeBinary('mpv', options)).toThrow(PACKAGED_MISSING_MESSAGE);
  });
});

describe('packaged missing runtime', () => {
  test('does not invoke a system package manager', async () => {
    await expect(ensureRuntimeDependencies({
      env: { MELO_PACKAGED: '1' },
      isFile: () => false,
      resolveOnPath: () => null,
      install: async () => {
        throw new Error('system installer should not run');
      },
    })).rejects.toThrow(PACKAGED_MISSING_MESSAGE);
  });
});

describe('version probing', () => {
  test('reads the first line of yt-dlp --version', async () => {
    const version = await probeBinaryVersion('C:/runtime/yt-dlp.exe', async () => ({
      exitCode: 0,
      stdout: '2026.08.19\n',
      stderr: '',
    }));
    expect(version).toBe('2026.08.19');
  });

  test('reads mpv --version from stdout', async () => {
    const version = await probeBinaryVersion('C:/runtime/mpv.exe', async () => ({
      exitCode: 0,
      stdout: 'mpv 0.40.0 Copyright © 2000-2026\n',
      stderr: '',
    }));
    expect(version).toStartWith('mpv 0.40.0');
  });

  test('returns null when the probe fails', async () => {
    expect(await probeBinaryVersion('missing', async () => ({ exitCode: 1, stdout: '', stderr: 'nope' }))).toBeNull();
  });
});

describe('runtime fetch checksums', () => {
  test('accepts a matching sha256', () => {
    const data = new TextEncoder().encode('melo');
    const hash = sha256Buffer(data);
    expect(() => assertSha256(data, hash, 'sample')).not.toThrow();
  });

  test('rejects a mismatched sha256', () => {
    expect(() => assertSha256(new Uint8Array([1, 2, 3]), '00'.repeat(32), 'sample')).toThrow(/sha256 mismatch/);
  });
});
