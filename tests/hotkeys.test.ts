import { describe, expect, test } from 'bun:test';
import { isSpaceReservedTarget, isTypingTarget, matchShortcut, SHORTCUTS, type ShortcutEvent } from '../gui/src/renderer/lib/hotkeys';

function key(key: string, extras: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return { key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...extras };
}

describe('hotkeys', () => {
  test('maps the documented shortcuts', () => {
    expect(matchShortcut(key(' '))).toBe('toggle');
    expect(matchShortcut(key('ArrowLeft'))).toBe('seekBack');
    expect(matchShortcut(key('ArrowRight'))).toBe('seekForward');
    expect(matchShortcut(key('ArrowLeft', { shiftKey: true }))).toBe('previous');
    expect(matchShortcut(key('ArrowRight', { shiftKey: true }))).toBe('next');
    expect(matchShortcut(key('ArrowUp'))).toBe('volumeUp');
    expect(matchShortcut(key('ArrowDown'))).toBe('volumeDown');
    expect(matchShortcut(key('m'))).toBe('mute');
    expect(matchShortcut(key('/'))).toBe('search');
    expect(matchShortcut(key('q'))).toBe('queue');
    expect(matchShortcut(key('f'))).toBe('favorite');
  });

  test('ignores modified keys except shift for prev/next', () => {
    expect(matchShortcut(key(' ', { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(key('q', { metaKey: true }))).toBeNull();
  });

  test('settings list covers every mapped id', () => {
    expect(SHORTCUTS.map(item => item.id)).toEqual([
      'toggle', 'seekBack', 'seekForward', 'previous', 'next',
      'volumeUp', 'volumeDown', 'mute', 'search', 'queue', 'favorite',
    ]);
  });

  test('typing targets skip capture', () => {
    const input = { isContentEditable: false, tagName: 'INPUT' };
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });
});
