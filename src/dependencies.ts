import { commandExists, isWindows, refreshExecutablePath } from './platform';
import {
  PACKAGED_MISSING_MESSAGE,
  getMissingRuntimeBinaries,
  isPackagedRuntime,
  type RuntimeName,
  type RuntimeResolveOptions,
} from './melo/runtime/binaries';

type DependencyName = RuntimeName;

const RUNTIME_DEPS: DependencyName[] = ['mpv', 'yt-dlp'];

export async function ensureRuntimeDependencies(options: RuntimeResolveOptions & {
  install?: (dep: DependencyName) => Promise<void>;
} = {}) {
  const env = options.env ?? process.env;
  refreshExecutablePath();

  let missing = getMissingRuntimeBinaries(options);
  if (missing.length === 0) return;

  if (isPackagedRuntime(env)) {
    throw new Error(PACKAGED_MISSING_MESSAGE);
  }

  if (env.MELO_SKIP_AUTO_INSTALL === '1') {
    throw new Error(formatMissingDependencies(missing));
  }

  process.stdout.write(`\nSetting up missing dependencies: ${missing.join(', ')}\n`);

  for (const dep of missing) {
    if (options.install) await options.install(dep);
    else await installDependency(dep);
    refreshExecutablePath();
  }

  missing = getMissingRuntimeBinaries(options);
  if (missing.length > 0) {
    throw new Error(formatMissingDependencies(missing));
  }
}

function formatMissingDependencies(deps: DependencyName[]): string {
  return [
    'Missing dependencies:',
    ...deps.map(dep => `  x ${dep}  ->  ${installHint(dep)}`),
  ].join('\n');
}

function installHint(dep: DependencyName): string {
  if (isWindows) {
    const wingetId = dep === 'mpv' ? 'shinchiro.mpv' : 'yt-dlp.yt-dlp';
    return `winget install --id ${wingetId}`;
  }

  if (process.platform === 'darwin') {
    return `brew install ${dep}`;
  }

  return `install ${dep} with your system package manager`;
}

async function installDependency(dep: DependencyName) {
  const command = getInstallCommand(dep);
  if (!command) {
    throw new Error(formatMissingDependencies([dep]));
  }

  process.stdout.write(`\n> ${command.join(' ')}\n`);
  const proc = Bun.spawn(command, {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;

  if (code !== 0) {
    throw new Error(`Failed to install ${dep}. Run manually: ${installHint(dep)}`);
  }
}

function getInstallCommand(dep: DependencyName): string[] | null {
  if (isWindows) {
    const wingetId = dep === 'mpv' ? 'shinchiro.mpv' : 'yt-dlp.yt-dlp';
    if (!commandExists('winget')) return null;
    return [
      'winget',
      'install',
      '--id',
      wingetId,
      '--exact',
      '--accept-package-agreements',
      '--accept-source-agreements',
    ];
  }

  if (process.platform === 'darwin') {
    return commandExists('brew') ? ['brew', 'install', dep] : null;
  }

  const sudo = process.getuid?.() === 0 ? [] : ['sudo'];
  if (sudo.length > 0 && !commandExists('sudo')) return null;

  if (commandExists('apt-get')) return [...sudo, 'apt-get', 'install', '-y', dep];
  if (commandExists('dnf')) return [...sudo, 'dnf', 'install', '-y', dep];
  if (commandExists('yum')) return [...sudo, 'yum', 'install', '-y', dep];
  if (commandExists('pacman')) return [...sudo, 'pacman', '-S', '--needed', '--noconfirm', dep];
  if (commandExists('zypper')) return [...sudo, 'zypper', 'install', '-y', dep];
  if (commandExists('apk')) return [...sudo, 'apk', 'add', dep];

  return null;
}
