export const MELO_THEME_KEY = 'melo-theme';
export const LEGACY_THEME_KEY = 'ym-theme';

export type StoredTheme = 'light' | 'dark' | 'system';

const VALID = new Set<string>(['light', 'dark', 'system']);

export interface ThemeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function asTheme(value: string | null): StoredTheme | null {
  return value && VALID.has(value) ? (value as StoredTheme) : null;
}

/** Read MELO theme; copy a one-time legacy `ym-theme` value into `melo-theme` if needed. */
export function readStoredTheme(store: ThemeStore): StoredTheme {
  const current = asTheme(store.getItem(MELO_THEME_KEY));
  if (current) return current;

  const legacy = asTheme(store.getItem(LEGACY_THEME_KEY));
  if (legacy) {
    store.setItem(MELO_THEME_KEY, legacy);
    return legacy;
  }

  return 'dark';
}

/** Persist theme under the MELO key only. */
export function writeStoredTheme(theme: StoredTheme, store: ThemeStore): void {
  store.setItem(MELO_THEME_KEY, theme);
}
