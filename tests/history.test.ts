import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { HistoryService } from '../src/melo/history/history-service';
import { JsonStore } from '../src/melo/persistence/json-store';
import type { Track } from '../src/melo/types';

function track(id: string): Track {
  return { id, title: id, url: `https://www.youtube.com/watch?v=${id}` };
}

describe('history', () => {
  test('clear empties persisted records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'melo-hist-'));
    const history = new HistoryService(new JsonStore(dir));
    history.record(track('a'));
    expect(history.snapshot()).toHaveLength(1);
    history.clear();
    expect(history.snapshot()).toEqual([]);
    expect(new HistoryService(new JsonStore(dir)).snapshot()).toEqual([]);
  });

  test('recently played is newest first and previous pops that same track', () => {
    const dir = mkdtempSync(join(tmpdir(), 'melo-hist-order-'));
    const history = new HistoryService(new JsonStore(dir));
    history.record(track('a'));
    history.record(track('b'));
    history.record(track('c'));
    expect(history.snapshot().map(item => item.id)).toEqual(['c', 'b', 'a']);
    expect(history.pop()?.id).toBe('c');
    expect(history.snapshot().map(item => item.id)).toEqual(['b', 'a']);
  });

  test('clearing recently played also clears previous', () => {
    const dir = mkdtempSync(join(tmpdir(), 'melo-hist-prev-'));
    const history = new HistoryService(new JsonStore(dir));
    history.record(track('a'));
    history.clear();
    expect(history.pop()).toBeUndefined();
  });
});
