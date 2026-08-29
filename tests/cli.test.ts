import { describe, expect, test } from 'bun:test';
import { parseCliArgs } from '../src/cli';

describe('CLI arguments', () => {
  test('starts interactively without arguments', () => {
    expect(parseCliArgs([])).toEqual({ action: 'interactive' });
  });

  test('joins an unquoted short search into one play query', () => {
    expect(parseCliArgs(['-s', 'alors', 'on', 'danse'])).toEqual({
      action: 'control',
      command: { type: 'play', query: 'alors on danse' },
    });
  });

  test('supports play and the long search option', () => {
    expect(parseCliArgs(['play', 'Alors on danse'])).toEqual({
      action: 'control',
      command: { type: 'play', query: 'Alors on danse' },
    });
    expect(parseCliArgs(['--search', 'Alors on danse'])).toEqual({
      action: 'control',
      command: { type: 'play', query: 'Alors on danse' },
    });
  });

  test('parses playback command aliases', () => {
    expect(parseCliArgs(['m'])).toEqual({ action: 'control', command: { type: 'mute' } });
    expect(parseCliArgs(['n'])).toEqual({ action: 'control', command: { type: 'next' } });
    expect(parseCliArgs(['p'])).toEqual({ action: 'control', command: { type: 'previous' } });
    expect(parseCliArgs(['t'])).toEqual({ action: 'control', command: { type: 'toggle' } });
    expect(parseCliArgs(['q'])).toEqual({ action: 'control', command: { type: 'quit' } });
  });

  test('parses absolute and relative volume', () => {
    expect(parseCliArgs(['volume', '50'])).toEqual({
      action: 'control',
      command: { type: 'volume', value: 50, relative: false },
    });
    expect(parseCliArgs(['volume', '+10'])).toEqual({
      action: 'control',
      command: { type: 'volume', value: 10, relative: true },
    });
    expect(parseCliArgs(['volume', '-10'])).toEqual({
      action: 'control',
      command: { type: 'volume', value: -10, relative: true },
    });
  });

  test('parses seek, shuffle, repeat, and queue commands', () => {
    expect(parseCliArgs(['seek', '-10'])).toEqual({
      action: 'control',
      command: { type: 'seek', seconds: -10 },
    });
    expect(parseCliArgs(['shuffle', 'on'])).toEqual({
      action: 'control',
      command: { type: 'shuffle', enabled: true },
    });
    expect(parseCliArgs(['x'])).toEqual({
      action: 'control',
      command: { type: 'shuffle', enabled: null },
    });
    expect(parseCliArgs(['repeat', 'all'])).toEqual({
      action: 'control',
      command: { type: 'repeat', mode: 'all' },
    });
    expect(parseCliArgs(['queue', 'clear'])).toEqual({
      action: 'control',
      command: { type: 'queue', clear: true },
    });
  });

  test('parses information and library aliases', () => {
    expect(parseCliArgs(['i'])).toEqual({ action: 'control', command: { type: 'now' } });
    expect(parseCliArgs(['f'])).toEqual({ action: 'control', command: { type: 'favorite' } });
    expect(parseCliArgs(['d'])).toEqual({ action: 'control', command: { type: 'download' } });
    expect(parseCliArgs(['status'])).toEqual({ action: 'control', command: { type: 'status' } });
  });

  test('rejects incomplete or invalid command values', () => {
    expect(() => parseCliArgs(['-s'])).toThrow('-s requires a song name.');
    expect(() => parseCliArgs(['volume', '101'])).toThrow('between 0 and 100');
    expect(() => parseCliArgs(['seek', '10'])).toThrow('relative value');
    expect(() => parseCliArgs(['shuffle', 'maybe'])).toThrow('on or off');
    expect(() => parseCliArgs(['repeat', 'track'])).toThrow('off, one, or all');
  });

  test('supports version and help flags', () => {
    expect(parseCliArgs(['-v'])).toEqual({ action: 'version' });
    expect(parseCliArgs(['h'])).toEqual({ action: 'help' });
  });

  test('rejects unknown commands', () => {
    expect(() => parseCliArgs(['--unknown'])).toThrow('Unknown command: --unknown');
  });
});
