import { describe, expect, test } from 'bun:test';
import {
  LEGACY_THEME_KEY,
  MELO_THEME_KEY,
  readStoredTheme,
  writeStoredTheme,
  type ThemeStore,
} from '../gui/src/renderer/lib/theme-storage';

class MemoryStore implements ThemeStore {
  constructor(private readonly data: Record<string, string> = {}) {}

  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key]! : null;
  }

  setItem(key: string, value: string): void {
    this.data[key] = value;
  }

  snapshot(): Record<string, string> {
    return { ...this.data };
  }
}

describe('theme storage identity', () => {
  test('fresh install reads and writes only melo-theme', () => {
    const store = new MemoryStore();
    expect(readStoredTheme(store)).toBe('dark');
    writeStoredTheme('light', store);
    expect(store.snapshot()).toEqual({ [MELO_THEME_KEY]: 'light' });
    expect(readStoredTheme(store)).toBe('light');
  });

  test('migrates ym-theme once into melo-theme and never writes the legacy key', () => {
    const store = new MemoryStore({ [LEGACY_THEME_KEY]: 'system' });
    expect(readStoredTheme(store)).toBe('system');
    expect(store.getItem(MELO_THEME_KEY)).toBe('system');
    expect(store.getItem(LEGACY_THEME_KEY)).toBe('system');

    writeStoredTheme('dark', store);
    expect(store.getItem(MELO_THEME_KEY)).toBe('dark');
    expect(store.getItem(LEGACY_THEME_KEY)).toBe('system');
    expect(readStoredTheme(store)).toBe('dark');
  });

  test('prefers an existing melo-theme over ym-theme', () => {
    const store = new MemoryStore({
      [MELO_THEME_KEY]: 'light',
      [LEGACY_THEME_KEY]: 'dark',
    });
    expect(readStoredTheme(store)).toBe('light');
    expect(store.snapshot()).toEqual({
      [MELO_THEME_KEY]: 'light',
      [LEGACY_THEME_KEY]: 'dark',
    });
  });
});
