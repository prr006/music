import type { ThemeStore } from './theme-storage';

export const MELO_SIDEBAR_KEY = 'melo-sidebar';

/** Collapsed (icon-only) is the default so the player keeps its current spacious look. */
export function readSidebarExpanded(store: ThemeStore): boolean {
  return store.getItem(MELO_SIDEBAR_KEY) === 'expanded';
}

export function writeSidebarExpanded(expanded: boolean, store: ThemeStore): void {
  store.setItem(MELO_SIDEBAR_KEY, expanded ? 'expanded' : 'collapsed');
}
