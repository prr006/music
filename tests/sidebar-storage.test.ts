import { describe, expect, test } from 'bun:test';
import { MELO_THEME_KEY, type ThemeStore } from '../gui/src/renderer/lib/theme-storage';
import {
  MELO_SIDEBAR_KEY,
  readSidebarExpanded,
  writeSidebarExpanded,
} from '../gui/src/renderer/lib/sidebar-storage';

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

describe('sidebar preference', () => {
  test('defaults to collapsed so the player stays spacious', () => {
    const store = new MemoryStore();
    expect(readSidebarExpanded(store)).toBe(false);
  });

  test('persists expanded and collapsed under melo-sidebar only', () => {
    const store = new MemoryStore({ [MELO_THEME_KEY]: 'dark' });
    writeSidebarExpanded(true, store);
    expect(readSidebarExpanded(store)).toBe(true);
    expect(store.getItem(MELO_SIDEBAR_KEY)).toBe('expanded');

    writeSidebarExpanded(false, store);
    expect(readSidebarExpanded(store)).toBe(false);
    expect(store.getItem(MELO_SIDEBAR_KEY)).toBe('collapsed');
    expect(store.getItem(MELO_THEME_KEY)).toBe('dark');
  });
});
