import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getConfigDir, getLegacyConfigDir, getLegacyMusicDir, getMusicDir } from '../../platform';
import { log, logError } from '../log';

const CONFIG_FILES = [
  'favorites.json',
  'history.json',
  'playlists.json',
  'downloads.json',
  'settings.json',
];

export interface MigratePaths {
  configFrom?: string;
  configTo?: string;
  musicFrom?: string;
  musicTo?: string;
}

export interface MigrateResult {
  configCopied: string[];
  musicCopied: string[];
}

function copyMissingFile(fromPath: string, toPath: string): boolean {
  if (!existsSync(fromPath) || existsSync(toPath)) return false;
  try {
    copyFileSync(fromPath, toPath);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError('persist', `migration copy failed ${fromPath} → ${toPath}: ${message}`);
    return false;
  }
}

function copyNamedFiles(fromDir: string, toDir: string, names: string[]): string[] {
  if (!existsSync(fromDir)) return [];
  mkdirSync(toDir, { recursive: true });
  const copied: string[] = [];
  for (const name of names) {
    if (copyMissingFile(join(fromDir, name), join(toDir, name))) copied.push(name);
  }
  return copied;
}

function copyDirectoryFiles(fromDir: string, toDir: string): string[] {
  if (!existsSync(fromDir)) return [];
  mkdirSync(toDir, { recursive: true });
  const copied: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(fromDir);
  } catch {
    return [];
  }
  for (const name of entries) {
    const fromPath = join(fromDir, name);
    try {
      if (!statSync(fromPath).isFile()) continue;
    } catch {
      continue;
    }
    if (copyMissingFile(fromPath, join(toDir, name))) copied.push(name);
  }
  return copied;
}

/** One-time, idempotent copy of legacy ytmusic-cli user data into the MELO directories. */
export function migrateUserData(paths: MigratePaths = {}): MigrateResult {
  const result: MigrateResult = {
    configCopied: copyNamedFiles(
      paths.configFrom ?? getLegacyConfigDir(),
      paths.configTo ?? getConfigDir(),
      CONFIG_FILES,
    ),
    musicCopied: copyDirectoryFiles(
      paths.musicFrom ?? getLegacyMusicDir(),
      paths.musicTo ?? getMusicDir(),
    ),
  };

  const total = result.configCopied.length + result.musicCopied.length;
  if (total > 0) {
    log(
      'persist',
      `migrated ${result.configCopied.length} config file(s) [${result.configCopied.join(', ') || 'none'}] and ${result.musicCopied.length} download(s) from the legacy data directory`,
    );
  }

  return result;
}
