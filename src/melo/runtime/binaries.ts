import { accessSync, constants, statSync } from 'fs';
import { join } from 'path';
import { resolveCommand } from '../../platform';

export type RuntimeName = 'yt-dlp' | 'mpv';

export const PACKAGED_MISSING_MESSAGE =
  "MELO's player files are missing. Reinstall MELO.";

export interface RuntimeResolveOptions {
  env?: NodeJS.Dict<string | undefined>;
  platform?: NodeJS.Platform;
  isFile?: (path: string) => boolean;
  resolveOnPath?: (command: string) => string | null;
}

export function isPackagedRuntime(env: NodeJS.Dict<string | undefined> = process.env): boolean {
  return env.MELO_PACKAGED === '1';
}

export function resolveRuntimeBinary(
  name: RuntimeName,
  options: RuntimeResolveOptions = {},
): string | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const isFile = options.isFile ?? defaultIsFile;

  const override = env[overrideKey(name)]?.trim();
  if (override && isFile(override)) return override;

  const names = executableNames(name, platform);
  const extraDirs = name === 'mpv' ? ['mpv'] : [];

  const userRoot = env.MELO_USER_RUNTIME?.trim();
  const fromUser = firstExisting(userRoot, extraDirs, names, isFile);
  if (fromUser) return fromUser;

  const bundledRoot = env.MELO_BUNDLED_RUNTIME?.trim();
  const fromBundled = firstExisting(bundledRoot, extraDirs, names, isFile);
  if (fromBundled) return fromBundled;

  if (isPackagedRuntime(env)) return null;

  const resolveOnPath = options.resolveOnPath ?? ((command: string) => resolveCommand(command));
  return resolveOnPath(name);
}

export function getMissingRuntimeBinaries(options: RuntimeResolveOptions = {}): RuntimeName[] {
  return (['mpv', 'yt-dlp'] as const).filter(name => !resolveRuntimeBinary(name, options));
}

export function requireRuntimeBinary(name: RuntimeName, options: RuntimeResolveOptions = {}): string {
  const resolved = resolveRuntimeBinary(name, options);
  if (resolved) return resolved;
  const env = options.env ?? process.env;
  if (isPackagedRuntime(env)) throw new Error(PACKAGED_MISSING_MESSAGE);
  throw new Error(`${name} is not installed.`);
}

function overrideKey(name: RuntimeName): string {
  return name === 'yt-dlp' ? 'MELO_YTDLP' : 'MELO_MPV';
}

function executableNames(name: RuntimeName, platform: NodeJS.Platform): string[] {
  if (name === 'yt-dlp') {
    return platform === 'win32' ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp', 'yt-dlp.exe'];
  }
  return platform === 'win32' ? ['mpv.exe', 'mpv'] : ['mpv', 'mpv.exe'];
}

function firstExisting(
  root: string | undefined,
  extraDirs: string[],
  names: string[],
  isFile: (path: string) => boolean,
): string | null {
  if (!root) return null;
  const dirs = ['', ...extraDirs];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = dir ? join(root, dir, name) : join(root, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

function defaultIsFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
