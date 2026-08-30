import { describe, expect, test, beforeEach } from 'bun:test';
import { EventEmitter } from 'events';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MeloApp } from '../src/melo/app';
import { JsonStore } from '../src/melo/persistence/json-store';
import type { PlaybackDriver, PlaybackSnapshot, RepeatMode, Track } from '../src/melo/types';

let mockLoadCalls: string[] = [];

let mockStopCalls = 0;

class MockPlayer extends EventEmitter implements PlaybackDriver {
  snapshot: PlaybackSnapshot = {
    paused: false,
    muted: false,
    timePos: 0,
    duration: 0,
    volume: 100,
    repeatMode: 'off',
  };

  async start() {}
  async quit() {}
  async load(url: string) { mockLoadCalls.push(url); this.snapshot.paused = false; }
  async togglePause() { this.snapshot.paused = !this.snapshot.paused; }
  async setPaused(paused: boolean) { this.snapshot.paused = paused; }
  async toggleMute() { this.snapshot.muted = !this.snapshot.muted; return this.snapshot.muted; }
  async seek(_s: number) {}
  async stop() { mockStopCalls += 1; this.snapshot.paused = true; }
  async setVolume(level: number) {
    this.snapshot.volume = Math.max(0, Math.min(100, Math.round(level)));
    return this.snapshot.volume;
  }
  async getVolume() { return this.snapshot.volume; }
  async setRepeatMode(mode: RepeatMode) { this.snapshot.repeatMode = mode; }
}

const mockSearch = async (query: string, limit?: number) => {
  const count = limit ?? 3;
  return Array.from({ length: count }, (_, i) => ({
    id: `search-${i}`,
    title: `Search Result ${i} for "${query}"`,
    url: `https://www.youtube.com/watch?v=search-${i}`,
    duration: 180 + i * 10,
    uploader: `Artist ${i}`,
    artwork: `https://i.ytimg.com/vi/search-${i}/mqdefault.jpg`,
  }));
};

const mockRelated = async (videoId: string, limit?: number) => {
  await new Promise(r => setTimeout(r, 10));
  const count = limit ?? 10;
  return Array.from({ length: count }, (_, i) => ({
    id: `mix-${videoId}-${i}`,
    title: `Mix Track ${i} for ${videoId}`,
    url: `https://www.youtube.com/watch?v=mix-${videoId}-${i}`,
    duration: 200 + i * 10,
    uploader: `Mix Artist ${i}`,
    artwork: `https://i.ytimg.com/vi/mix-${videoId}-${i}/mqdefault.jpg`,
  }));
};

function makeTrack(id: string, title?: string): Track {
  return {
    id,
    title: title ?? `Track ${id}`,
    url: `https://www.youtube.com/watch?v=${id}`,
    duration: 200,
    uploader: `Artist ${id}`,
    artwork: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
  };
}

function waitForEvent(app: MeloApp, eventName: string, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeoutMs);

    app.once(eventName, (data: any) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

describe('MeloApp', () => {
  let engine: MeloApp;
  let player: MockPlayer;

  beforeEach(() => {
    mockLoadCalls = [];
    mockStopCalls = 0;
    player = new MockPlayer();
    engine = new MeloApp({
      playback: player,
      search: { search: mockSearch },
      radio: { related: mockRelated },
      resolver: { resolveAudioUrl: async track => track.url },
      store: new JsonStore(mkdtempSync(join(tmpdir(), 'melo-engine-'))),
    });
  });

  test('play() starts the track immediately', async () => {
    const track = makeTrack('A', 'Song A');
    await engine.play(track);

    expect(engine.currentTrack).toEqual(track);
    expect(mockLoadCalls).toContain(track.url);
  });

  test('play() clears the queue before radio loads', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    expect(engine.queue.length).toBeGreaterThan(0);
    expect(engine.queue.every(qi => qi.source === 'radio')).toBe(true);
  });

  test('play() adds the previous track to history', async () => {
    await engine.play(makeTrack('A'));
    await engine.play(makeTrack('B'));

    expect(engine.history.length).toBe(1);
    expect(engine.history[0]!.id).toBe('A');
  });

  test('play() generates radio mix asynchronously', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    expect(engine.queue.length).toBeGreaterThan(0);
    expect(engine.queue.every(qi => qi.source === 'radio')).toBe(true);
    expect(engine.queue.some(qi => qi.track.id === 'A')).toBe(false);
  });

  test('addToQueue() appends to the end', () => {
    engine.addToQueue(makeTrack('B'));
    engine.addToQueue(makeTrack('C'));

    const queue = engine.queue.snapshot();
    expect(queue.length).toBe(2);
    expect(queue[0]!.track.id).toBe('B');
    expect(queue[0]!.source).toBe('manual');
    expect(queue[1]!.track.id).toBe('C');
    expect(queue[1]!.source).toBe('manual');
  });

  test('playNext() inserts at the front of the queue', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    const radioCountBefore = engine.queue.length;
    engine.playNext(makeTrack('B', 'Song B'));

    const queue = engine.queue.snapshot();
    expect(queue.length).toBe(radioCountBefore + 1);
    expect(queue[0]!.track.id).toBe('B');
    expect(queue[0]!.source).toBe('manual');
  });

  test('playNext() puts track immediately after current', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    engine.playNext(makeTrack('B'));
    await engine.playNextTrack();

    expect(engine.currentTrack!.id).toBe('B');
  });

  test('removeFromQueue() removes at the correct index', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    engine.addToQueue(makeTrack('X'));
    engine.addToQueue(makeTrack('Y'));

    const lenBefore = engine.queue.length;
    engine.removeFromQueue(0);
    expect(engine.queue.length).toBe(lenBefore - 1);
  });

  test('removeFromQueue() ignores out-of-bounds index', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    const lenBefore = engine.queue.length;
    engine.removeFromQueue(-1);
    expect(engine.queue.length).toBe(lenBefore);
    engine.removeFromQueue(999);
    expect(engine.queue.length).toBe(lenBefore);
  });

  test('clearQueue() empties the queue and stops radio', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    expect(engine.queue.length).toBeGreaterThan(0);
    engine.clearQueue();
    expect(engine.queue.length).toBe(0);
  });

  test('manual tracks are tagged correctly in the queue', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    engine.addToQueue(makeTrack('X'));
    engine.addToQueue(makeTrack('Y'));

    const lastTwo = engine.queue.slice(-2);
    expect(lastTwo[0]!.source).toBe('manual');
    expect(lastTwo[1]!.source).toBe('manual');
    expect(lastTwo[0]!.track.id).toBe('X');
    expect(lastTwo[1]!.track.id).toBe('Y');
  });

  test('playNextTrack() consumes manual tracks first', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    engine.playNext(makeTrack('Z'));
    await engine.playNextTrack();
    expect(engine.currentTrack!.id).toBe('Z');

    await engine.playNextTrack();
    expect(engine.currentTrack!.id).not.toBe('A');
    expect(engine.currentTrack!.id).not.toBe('Z');
  });

  test('manual + radio tracks coexist in the same queue', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    const radioCount = engine.queue.filter(qi => qi.source === 'radio').length;
    expect(radioCount).toBeGreaterThan(0);

    engine.addToQueue(makeTrack('X'));
    const manualCount = engine.queue.filter(qi => qi.source === 'manual').length;
    expect(manualCount).toBe(1);
    expect(engine.queue.length).toBe(radioCount + manualCount);
  });

  test('setShuffle(true) shuffles only radio tracks, not manual', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    engine.addToQueue(makeTrack('X'));
    engine.addToQueue(makeTrack('Y'));

    const manualBefore = engine.queue.filter(qi => qi.source === 'manual').map(qi => qi.track.id);
    engine.setShuffle(true);
    const manualAfter = engine.queue.filter(qi => qi.source === 'manual').map(qi => qi.track.id);
    expect(manualAfter).toEqual(manualBefore);
  });

  test('setShuffle(true) emits shuffle-changed event', async () => {
    const eventPromise = waitForEvent(engine, 'shuffle-changed');
    engine.setShuffle(true);
    await eventPromise;
  });

  test('radio tracks exclude the current track', async () => {
    const track = makeTrack('A');
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(track);
    await refilledPromise;
    expect(engine.queue.some(qi => qi.track.id === track.id)).toBe(false);
  });

  test('radio refill happens when queue drops below threshold', async () => {
    const refilledPromise1 = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise1;

    const initialRadioCount = engine.queue.filter(qi => qi.source === 'radio').length;
    expect(initialRadioCount).toBeGreaterThanOrEqual(5);

    for (let i = 0; i < initialRadioCount - 3; i++) {
      if (engine.queue.length > 0) {
        await engine.playNextTrack();
      }
    }

    const refilledPromise2 = waitForEvent(engine, 'queue-refilled', 5000);
    await refilledPromise2;
    expect(engine.queue.filter(qi => qi.source === 'radio').length).toBeGreaterThan(0);
  });

  test('stale radio results are discarded when play() is called again', async () => {
    const event1 = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await event1;

    const event2 = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('B'));
    await event2;

    expect(engine.queue.every(qi => qi.source === 'radio')).toBe(true);
    expect(engine.queue.some(qi => qi.track.id.includes('mix-B'))).toBe(true);
  });

  test('playPreviousTrack() goes back to history', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    await engine.play(makeTrack('B'));
    expect(engine.currentTrack!.id).toBe('B');

    await engine.playPreviousTrack();
    expect(engine.currentTrack!.id).toBe('A');
    expect(engine.history.length).toBe(0);
  });

  test('playPreviousTrack() returns false when history is empty', async () => {
    await engine.play(makeTrack('A'));
    const result = await engine.playPreviousTrack();
    expect(result).toBe(false);
  });

  test('repeat-one: end-file with reason eof does not advance', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;
    engine.addToQueue(makeTrack('X'));

    await engine.setRepeatMode('one');
    player.emit('end-file', { reason: 'eof' });
    await new Promise(r => setTimeout(r, 20));
    expect(engine.currentTrack!.id).toBe('A');
  });

  test('playNextTrack() advances to the next track', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    const nextTrackId = engine.queue.snapshot()[0]!.track.id;
    await engine.playNextTrack();

    expect(engine.currentTrack!.id).toBe(nextTrackId);
    expect(engine.history[0]!.id).toBe('A');
  });

  test('playNextTrack() returns false when queue is empty', async () => {
    await engine.play(makeTrack('A'));
    engine.clearQueue();
    const result = await engine.playNextTrack();
    expect(result).toBe(false);
  });

  test('toggleFavorite() adds and removes favorites', () => {
    const track = makeTrack('A');
    const added = engine.toggleFavorite(track);
    expect(added).toBe(true);
    expect(engine.isFavorite('A')).toBe(true);

    const removed = engine.toggleFavorite(track);
    expect(removed).toBe(false);
    expect(engine.isFavorite('A')).toBe(false);
  });

  test('track-changed event is emitted on play()', async () => {
    const track = makeTrack('A');
    const eventPromise = waitForEvent(engine, 'track-changed');
    await engine.play(track);
    const event = await eventPromise;
    expect(event).toEqual({ type: 'track-changed', track });
  });

  test('queue-changed event is emitted on addToQueue()', async () => {
    const eventPromise = waitForEvent(engine, 'queue-changed');
    engine.addToQueue(makeTrack('X'));
    await eventPromise;
  });

  test('queue-changed event is emitted on playNext()', async () => {
    const eventPromise = waitForEvent(engine, 'queue-changed');
    engine.playNext(makeTrack('X'));
    await eventPromise;
  });

  test('queue-changed event is emitted on removeFromQueue()', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    const eventPromise = waitForEvent(engine, 'queue-changed');
    engine.removeFromQueue(0);
    await eventPromise;
  });

  test('favorites-changed event is emitted on toggleFavorite()', async () => {
    const eventPromise = waitForEvent(engine, 'favorites-changed');
    engine.toggleFavorite(makeTrack('A'));
    await eventPromise;
  });

  test('search empty query returns no results', async () => {
    const tracks = await engine.searchTracks('   ');
    expect(tracks).toEqual([]);
  });

  test('search failure does not crash the app', async () => {
    const failing = new MeloApp({
      playback: player,
      search: { search: async () => { throw new Error('network down'); } },
      radio: { related: async () => [] },
      resolver: { resolveAudioUrl: async track => track.url },
      store: new JsonStore(mkdtempSync(join(tmpdir(), 'melo-fail-'))),
    });
    expect(await failing.searchTracks('hello')).toEqual([]);
    expect(failing.currentTrack).toBeNull();
  });

  test('resolver failure falls back to watch URL', async () => {
    const failing = new MeloApp({
      playback: player,
      search: { search: mockSearch },
      radio: { related: async () => [] },
      resolver: { resolveAudioUrl: async () => { throw new Error('no stream'); } },
      store: new JsonStore(mkdtempSync(join(tmpdir(), 'melo-resolve-'))),
    });
    const track = makeTrack('A');
    await failing.play(track);
    expect(mockLoadCalls).toContain(track.url);
  });

  test('stop() clears current track and queue without crashing', async () => {
    await engine.play(makeTrack('A'));
    await engine.stop();
    expect(engine.currentTrack).toBeNull();
    expect(engine.queue.length).toBe(0);
  });

  test('snapshot is the authoritative state', async () => {
    await engine.play(makeTrack('A'));
    const snap = engine.snapshot();
    expect(snap.currentTrack?.id).toBe('A');
    expect(snap.volume).toBe(100);
    expect(snap.repeat).toBe('off');
    expect(Array.isArray(snap.queue)).toBe(true);
  });

  test('play() stops current audio before resolving the next track', async () => {
    await engine.play(makeTrack('A'));
    const stopsAfterFirst = mockStopCalls;
    await engine.play(makeTrack('B'));
    expect(mockStopCalls).toBeGreaterThan(stopsAfterFirst);
    expect(mockLoadCalls[mockLoadCalls.length - 1]).toBe(makeTrack('B').url);
  });

  test('playNextTrack() stops current audio before loading the next track', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;
    const stopsBefore = mockStopCalls;
    const loadsBefore = mockLoadCalls.length;
    await engine.playNextTrack();
    expect(mockStopCalls).toBeGreaterThan(stopsBefore);
    expect(mockLoadCalls.length).toBeGreaterThan(loadsBefore);
  });

  test('stale stream resolves are discarded when a newer play() starts', async () => {
    let releaseSlow: () => void = () => {};
    const slowGate = new Promise<void>(resolve => { releaseSlow = resolve; });
    const loads: string[] = [];
    const stalePlayer = new MockPlayer();
    stalePlayer.load = async (url: string) => { loads.push(url); };
    const delayed = new MeloApp({
      playback: stalePlayer,
      search: { search: mockSearch },
      radio: { related: async () => [] },
      resolver: {
        resolveAudioUrl: async track => {
          if (track.id === 'slow') await slowGate;
          return `stream:${track.id}`;
        },
      },
      store: new JsonStore(mkdtempSync(join(tmpdir(), 'melo-stale-'))),
    });

    const slowPlay = delayed.play(makeTrack('slow'));
    await new Promise(r => setTimeout(r, 20));
    await delayed.play(makeTrack('fast'));
    releaseSlow();
    await slowPlay;

    expect(loads).toEqual(['stream:fast']);
    expect(delayed.currentTrack?.id).toBe('fast');
  });
});
