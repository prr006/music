import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { getConfigDir } from '../../platform';
import { logError } from '../log';

export class JsonStore {
  constructor(private readonly dir = getConfigDir()) {}

  path(name: string): string {
    return join(this.dir, name);
  }

  read<T>(name: string, fallback: T): T {
    try {
      const text = readFileSync(this.path(name), 'utf8');
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  }

  write(name: string, value: unknown): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      const target = this.path(name);
      const tmp = `${target}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(value, null, 2));
      renameSync(tmp, target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError('persist', `failed to write ${name}: ${message}`);
      try {
        mkdirSync(dirname(this.path(name)), { recursive: true });
        writeFileSync(this.path(name), JSON.stringify(value, null, 2));
      } catch {}
    }
  }
}
