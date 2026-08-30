#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNTIME_DEPENDENCIES = ['mpv', 'yt-dlp'];

const WINGET_PACKAGES = {
  mpv: 'shinchiro.mpv',
  'yt-dlp': 'yt-dlp.yt-dlp',
};

function executableNames(command, platform, env) {
  if (platform !== 'win32' || /\.[^\\/]+$/.test(command)) {
    return [command];
  }

  const pathExt = env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  const extensions = pathExt
    .split(';')
    .map(extension => extension.toLowerCase())
    .filter(extension => extension !== '.com');

  return Array.from(new Set(['.exe', '.cmd', '.bat', ...extensions]))
    .map(extension => `${command}${extension}`);
}

function isExecutable(path, platform) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findExecutable(command, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const pathValue = env.Path || env.PATH || '';
  const pathDelimiter = platform === 'win32' ? ';' : delimiter;
  const searchDirectories = pathValue.split(pathDelimiter).filter(Boolean);

  if (platform === 'darwin') {
    searchDirectories.push('/opt/homebrew/bin', '/usr/local/bin');
  }

  const names = executableNames(command, platform, env);
  for (const directory of Array.from(new Set(searchDirectories))) {
    for (const name of names) {
      const candidate = join(directory, name);
      if (isExecutable(candidate, platform)) return candidate;
    }
  }

  return null;
}

export function getMissingDependencies(resolveCommand) {
  return RUNTIME_DEPENDENCIES.filter(dependency => !resolveCommand(dependency));
}

export function createInstallCommands(options) {
  const { platform, missing, resolveCommand } = options;
  if (missing.length === 0) return [];

  if (platform === 'darwin') {
    const brew = resolveCommand('brew');
    return brew ? [{ command: brew, args: ['install', ...missing] }] : null;
  }

  if (platform === 'win32') {
    const winget = resolveCommand('winget');
    if (!winget) return null;

    return missing.map(dependency => ({
      command: winget,
      args: [
        'install',
        '--id',
        WINGET_PACKAGES[dependency],
        '--exact',
        '--accept-package-agreements',
        '--accept-source-agreements',
      ],
    }));
  }

  const getuid = options.getuid || process.getuid;
  const useSudo = typeof getuid !== 'function' || getuid() !== 0;
  const sudo = useSudo ? resolveCommand('sudo') : null;
  if (useSudo && !sudo) return null;

  const managers = [
    ['apt-get', ['install', '-y', ...missing]],
    ['dnf', ['install', '-y', ...missing]],
    ['yum', ['install', '-y', ...missing]],
    ['pacman', ['-S', '--needed', '--noconfirm', ...missing]],
    ['zypper', ['install', '-y', ...missing]],
    ['apk', ['add', ...missing]],
  ];

  for (const [managerName, args] of managers) {
    const manager = resolveCommand(managerName);
    if (!manager) continue;

    return [{
      command: useSudo ? sudo : manager,
      args: useSudo ? [manager, ...args] : args,
    }];
  }

  return null;
}

export function getLifecycleSkipReason(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();

  if (env.MELO_SKIP_AUTO_INSTALL === '1') return 'disabled by MELO_SKIP_AUTO_INSTALL';
  if (env.MELO_INSTALL_DRY_RUN === '1' || env.MELO_FORCE_AUTO_INSTALL === '1') return null;
  if (env.CI) return 'running in CI';
  if (existsSync(join(cwd, '.git'))) return 'running from a source checkout';

  return null;
}

function formatCommand({ command, args }) {
  return [command, ...args].join(' ');
}

function manualInstallHint(platform, missing) {
  if (platform === 'darwin') return `brew install ${missing.join(' ')}`;
  if (platform === 'win32') {
    return missing.map(dependency => `winget install --id ${WINGET_PACKAGES[dependency]}`).join('; ');
  }
  return `install ${missing.join(' and ')} with your system package manager`;
}

export function installRuntimeDependencies(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const log = options.log || console.log;
  const warn = options.warn || console.warn;
  const resolveCommand = options.resolveCommand
    || (command => findExecutable(command, { platform, env }));
  const skipReason = getLifecycleSkipReason({ env, cwd: options.cwd });

  if (skipReason) {
    log(`melo: dependency setup skipped (${skipReason}).`);
    return { status: 'skipped', missing: [] };
  }

  const missing = getMissingDependencies(resolveCommand);
  if (missing.length === 0) {
    log('melo: mpv and yt-dlp are ready.');
    return { status: 'ready', missing: [] };
  }

  log(`melo: installing runtime dependencies: ${missing.join(', ')}`);
  const commands = createInstallCommands({
    platform,
    missing,
    resolveCommand,
    getuid: options.getuid,
  });

  if (!commands) {
    warn(`melo: automatic setup is unavailable. Run: ${manualInstallHint(platform, missing)}`);
    warn('melo: installation will continue and setup will be retried on first launch.');
    return { status: 'unavailable', missing };
  }

  const dryRun = env.MELO_INSTALL_DRY_RUN === '1';
  const spawn = options.spawn || spawnSync;
  for (const command of commands) {
    log(`> ${formatCommand(command)}`);
    if (dryRun) continue;

    const result = spawn(command.command, command.args, { stdio: 'inherit', env });
    if (result.error || result.status !== 0) {
      const detail = result.error ? `: ${result.error.message}` : ` (exit ${result.status})`;
      warn(`melo: dependency installation failed${detail}.`);
      warn(`melo: run manually: ${manualInstallHint(platform, missing)}`);
      warn('melo: installation will continue and setup will be retried on first launch.');
      return { status: 'failed', missing };
    }
  }

  if (dryRun) return { status: 'dry-run', missing };

  const remaining = getMissingDependencies(resolveCommand);
  if (remaining.length > 0) {
    warn(`melo: setup completed, but these commands are not on PATH yet: ${remaining.join(', ')}`);
    warn('melo: open a new terminal before launching melo.');
    return { status: 'path-refresh-needed', missing: remaining };
  }

  log('melo: mpv and yt-dlp installed successfully.');
  return { status: 'installed', missing: [] };
}

const scriptPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);

if (scriptPath === modulePath) {
  try {
    installRuntimeDependencies();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`melo: dependency setup failed: ${message}`);
    console.warn('melo: installation will continue and setup will be retried on first launch.');
  }
}
