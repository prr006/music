import { describe, expect, test } from 'bun:test';
import {
  createInstallCommands,
  getLifecycleSkipReason,
  getMissingDependencies,
  installRuntimeDependencies,
} from '../scripts/install-runtime-deps.js';

describe('npm runtime dependency installer', () => {
  test('detects only missing runtime commands', () => {
    expect(getMissingDependencies((command: string) => command === 'mpv' ? '/bin/mpv' : null))
      .toEqual(['yt-dlp']);
  });

  test('installs all missing macOS dependencies with Homebrew', () => {
    const commands = createInstallCommands({
      platform: 'darwin',
      missing: ['mpv', 'yt-dlp'],
      resolveCommand: (command: string) => command === 'brew' ? '/opt/homebrew/bin/brew' : null,
    });

    expect(commands).toEqual([{
      command: '/opt/homebrew/bin/brew',
      args: ['install', 'mpv', 'yt-dlp'],
    }]);
  });

  test('uses exact winget packages on Windows', () => {
    const commands = createInstallCommands({
      platform: 'win32',
      missing: ['mpv', 'yt-dlp'],
      resolveCommand: (command: string) => command === 'winget' ? 'C:\\winget.exe' : null,
    });

    expect(commands).toHaveLength(2);
    expect(commands?.[0]?.args).toContain('shinchiro.mpv');
    expect(commands?.[1]?.args).toContain('yt-dlp.yt-dlp');
  });

  test('uses sudo and an available Linux package manager', () => {
    const commands = createInstallCommands({
      platform: 'linux',
      missing: ['mpv', 'yt-dlp'],
      resolveCommand: (command: string) => ({
        sudo: '/usr/bin/sudo',
        'apt-get': '/usr/bin/apt-get',
      } as Record<string, string>)[command] || null,
      getuid: () => 501,
    });

    expect(commands).toEqual([{
      command: '/usr/bin/sudo',
      args: ['/usr/bin/apt-get', 'install', '-y', 'mpv', 'yt-dlp'],
    }]);
  });

  test('skips source and CI installs unless explicitly dry-running', () => {
    expect(getLifecycleSkipReason({ cwd: import.meta.dir + '/..', env: {} }))
      .toBe('running from a source checkout');
    expect(getLifecycleSkipReason({ cwd: '/tmp/package', env: { CI: '1' } }))
      .toBe('running in CI');
    expect(getLifecycleSkipReason({
      cwd: import.meta.dir + '/..',
      env: { MELO_INSTALL_DRY_RUN: '1' },
    })).toBeNull();
  });

  test('dry-run exercises installation without spawning a package manager', () => {
    const output: string[] = [];
    let spawnCalled = false;
    const result = installRuntimeDependencies({
      platform: 'darwin',
      cwd: import.meta.dir + '/..',
      env: { MELO_INSTALL_DRY_RUN: '1' },
      resolveCommand: (command: string) => command === 'brew' ? '/opt/homebrew/bin/brew' : null,
      spawn: () => {
        spawnCalled = true;
        return { status: 0 };
      },
      log: (message: string) => output.push(message),
      warn: (message: string) => output.push(message),
    });

    expect(result.status).toBe('dry-run');
    expect(spawnCalled).toBeFalse();
    expect(output).toContain('> /opt/homebrew/bin/brew install mpv yt-dlp');
  });
});
