export type ShortcutId =
  | 'toggle'
  | 'seekBack'
  | 'seekForward'
  | 'previous'
  | 'next'
  | 'volumeUp'
  | 'volumeDown'
  | 'mute'
  | 'search'
  | 'queue'
  | 'favorite';

export interface ShortcutSpec {
  id: ShortcutId;
  label: string;
  keys: string;
}

export const SHORTCUTS: ShortcutSpec[] = [
  { id: 'toggle', label: 'Play / pause', keys: 'Space' },
  { id: 'seekBack', label: 'Seek back', keys: '←' },
  { id: 'seekForward', label: 'Seek forward', keys: '→' },
  { id: 'previous', label: 'Previous track', keys: 'Shift+←' },
  { id: 'next', label: 'Next track', keys: 'Shift+→' },
  { id: 'volumeUp', label: 'Volume up', keys: '↑' },
  { id: 'volumeDown', label: 'Volume down', keys: '↓' },
  { id: 'mute', label: 'Mute', keys: 'M' },
  { id: 'search', label: 'Search', keys: '/' },
  { id: 'queue', label: 'Toggle queue', keys: 'Q' },
  { id: 'favorite', label: 'Favorite', keys: 'F' },
];

export interface ShortcutEvent {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { isContentEditable?: boolean; tagName?: string };
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function isSpaceReservedTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const tag = (target as { tagName?: string }).tagName;
  return tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY';
}

export function matchShortcut(event: ShortcutEvent): ShortcutId | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = event.key;
  if (event.shiftKey && key === 'ArrowLeft') return 'previous';
  if (event.shiftKey && key === 'ArrowRight') return 'next';
  if (event.shiftKey) return null;
  if (key === ' ' || key === 'Spacebar') return 'toggle';
  if (key === 'ArrowLeft') return 'seekBack';
  if (key === 'ArrowRight') return 'seekForward';
  if (key === 'ArrowUp') return 'volumeUp';
  if (key === 'ArrowDown') return 'volumeDown';
  if (key === 'm' || key === 'M') return 'mute';
  if (key === '/') return 'search';
  if (key === 'q' || key === 'Q') return 'queue';
  if (key === 'f' || key === 'F') return 'favorite';
  return null;
}
