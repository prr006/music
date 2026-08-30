import { describe, expect, test } from 'bun:test';
import { QueueService } from '../src/melo/queue/queue-service';
import type { Track } from '../src/melo/types';

function track(id: string): Track {
  return { id, title: id, url: `https://www.youtube.com/watch?v=${id}` };
}

describe('queue reorder', () => {
  test('moves an item from one index to another', () => {
    const queue = new QueueService();
    queue.add(track('a'));
    queue.add(track('b'));
    queue.add(track('c'));
    expect(queue.move(0, 2)).toBe(true);
    expect(queue.snapshot().map(item => item.track.id)).toEqual(['b', 'c', 'a']);
  });

  test('rejects out of range indexes', () => {
    const queue = new QueueService();
    queue.add(track('a'));
    expect(queue.move(0, 4)).toBe(false);
    expect(queue.move(-1, 0)).toBe(false);
  });
});
