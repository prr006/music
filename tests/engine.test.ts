import { describe, expect, test, beforeEach } from 'bun:test';
import { mock } from 'bun:test';
import { EventEmitter } from 'events';

// ─── Mock Player ──────────────────────────────────────────────────────────

let mockLoadTrackCalls: string[] = [];

class MockPlayer extends EventEmitter {
  state = {
    title: '',
    paused: false,
    muted: false,
    timePos: 0,
    duration: 0,
    volume: 100,
    repeatMode: 'off' as 'off' | 'one' | 'all',
  };

  async start() {}
  async quit() {}
  async loadTrack(url: string) { mockLoadTrackCalls.push(url); }
  async togglePause() { this.state.paused = !this.state.paused; }
  async setPaused(paused: boolean) { this.state.paused = paused; }
  async toggleMute() { this.state.muted = !this.state.muted; return this.state.muted; }
  async seek(_s: number) {}
  async stop() {}
  async setVolume(level: number) { this.state.volume = level; }
  async getVolume() { return this.state.volume; }
  async setRepeatMode(mode: 'off' | 'one' | 'all') { this.state.repeatMode = mode; }
}

// ─── Mock search/fetchMix ─────────────────────────────────────────────────

const mockSearch = async (query: string, limit?: number) => {
  const count = limit ?? 3;
  return Array.from({ length: count }, (_, i) => ({
    id: `search-${i}`,
    title: `Search Result ${i} for "${query}"`,
    url: `https://youtube.com/watch?v=search-${i}`,
    duration: 180 + i * 10,
    uploader: `Artist ${i}`,
  }));
};

const mockFetchMix = async (videoId: string, limit?: number) => {
  // Small delay to simulate async network
  await new Promise(r => setTimeout(r, 10));
  const count = limit ?? 10;
  return Array.from({ length: count }, (_, i) => ({
    id: `mix-${videoId}-${i}`,
    title: `Mix Track ${i} for ${videoId}`,
    url: `https://youtube.com/watch?v=mix-${videoId}-${i}`,
    duration: 200 + i * 10,
    uploader: `Mix Artist ${i}`,
  }));
};

// ─── Mock config ──────────────────────────────────────────────────────────

let mockFavorites: Track[] = [];

mock.module('../src/config', () => ({
  loadFavorites: () => mockFavorites,
  saveFavorites: (favs: Track[]) => { mockFavorites = favs; },
  isFavorite: (favs: Track[], id: string) => favs.some((t: Track) => t.id === id),
  toggleFavorite: (favs: Track[], track: Track) => {
    const idx = favs.findIndex((t: Track) => t.id === track.id);
    if (idx >= 0) {
      favs.splice(idx, 1);
      return { favorites: favs, added: false };
    }
    favs.push(track);
    return { favorites: favs, added: true };
  },
  loadPlaylists: () => [],
  createPlaylist: () => ({ id: 'pl-1', name: 'Test', tracks: [], createdAt: '' }),
  deletePlaylist: () => [],
  renamePlaylist: () => {},
  addTrackToPlaylist: () => true,
  removeTrackFromPlaylist: () => {},
  loadDownloads: () => [],
  isDownloaded: () => false,
  addDownloadRecord: (dl: Track[], track: Track) => [...dl, track],
  deleteDownloadRecord: (dl: Track[], id: string) => dl.filter((t: Track) => t.id !== id),
  loadSettings: () => ({ lang: 'en' }),
  saveSettings: () => {},
  MUSIC_DIR: '/tmp/test-music',
}));

// ─── Import engine ────────────────────────────────────────────────────────

import { PlaybackEngine } from '../src/engine';
import type { Track } from '../src/types';

function makeTrack(id: string, title?: string): Track {
  return {
    id,
    title: title ?? `Track ${id}`,
    url: `https://youtube.com/watch?v=${id}`,
    duration: 200,
    uploader: `Artist ${id}`,
  };
}

function waitForEvent(engine: PlaybackEngine, eventName: string, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeoutMs);

    engine.once(eventName, (data: any) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('PlaybackEngine', () => {
  let engine: PlaybackEngine;
  let player: MockPlayer;

  beforeEach(() => {
    mockLoadTrackCalls = [];
    mockFavorites = [];
    player = new MockPlayer();
    engine = new PlaybackEngine({
      player: player as any,
      searchFn: mockSearch,
      fetchMixFn: mockFetchMix,
      favorites: [],
      playlists: [],
      downloads: [],
    });
  });

  // ─── Play ────────────────────────────────────────────────────────────

  test('play() starts the track immediately', async () => {
    const track = makeTrack('A', 'Song A');
    await engine.play(track);

    expect(engine.currentTrack).toEqual(track);
    expect(mockLoadTrackCalls).toContain(track.url);
  });

  test('play() clears the queue before radio loads', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');

    const track = makeTrack('A');
    await engine.play(track);

    await refilledPromise;

    // After radio loads, queue should have radio tracks
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
    const track = makeTrack('A');
    const refilledPromise = waitForEvent(engine, 'queue-refilled');

    await engine.play(track);
    await refilledPromise;

    expect(engine.queue.length).toBeGreaterThan(0);
    expect(engine.queue.every(qi => qi.source === 'radio')).toBe(true);
    // The current track should not be in the queue
    expect(engine.queue.some(qi => qi.track.id === 'A')).toBe(false);
  });

  // ─── Add to Queue ────────────────────────────────────────────────────

  test('addToQueue() appends to the end', async () => {
    const trackA = makeTrack('A');
    const trackB = makeTrack('B');
    const trackC = makeTrack('C');

    engine.addToQueue(trackB);
    engine.addToQueue(trackC);

    expect(engine.queue.length).toBe(2);
    expect(engine.queue[0]!.track.id).toBe('B');
    expect(engine.queue[0]!.source).toBe('manual');
    expect(engine.queue[1]!.track.id).toBe('C');
    expect(engine.queue[1]!.source).toBe('manual');
  });

  // ─── Play Next ───────────────────────────────────────────────────────

  test('playNext() inserts at the front of the queue', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    const radioCountBefore = engine.queue.length;

    engine.playNext(makeTrack('B', 'Song B'));

    expect(engine.queue.length).toBe(radioCountBefore + 1);
    expect(engine.queue[0]!.track.id).toBe('B');
    expect(engine.queue[0]!.source).toBe('manual');
  });

  test('playNext() puts track immediately after current', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    engine.playNext(makeTrack('B'));
    await engine.playNextTrack();

    expect(engine.currentTrack!.id).toBe('B');
  });

  // ─── Remove from Queue ───────────────────────────────────────────────

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

  // ─── Clear Queue ─────────────────────────────────────────────────────

  test('clearQueue() empties the queue and stops radio', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    expect(engine.queue.length).toBeGreaterThan(0);
    engine.clearQueue();
    expect(engine.queue.length).toBe(0);
  });

  // ─── Queue Ordering ──────────────────────────────────────────────────

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

  // ─── Shuffle ─────────────────────────────────────────────────────────

  test('setShuffle(true) shuffles only radio tracks, not manual', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    engine.addToQueue(makeTrack('X'));
    engine.addToQueue(makeTrack('Y'));

    const manualBefore = engine.queue
      .filter(qi => qi.source === 'manual')
      .map(qi => qi.track.id);

    engine.setShuffle(true);

    const manualAfter = engine.queue
      .filter(qi => qi.source === 'manual')
      .map(qi => qi.track.id);

    expect(manualAfter!).toEqual(manualBefore);
  });

  test('setShuffle(true) emits shuffle-changed event', async () => {
    const eventPromise = waitForEvent(engine, 'shuffle-changed');
    engine.setShuffle(true);
    await eventPromise;
  });

  // ─── Radio Generation ────────────────────────────────────────────────

  test('radio tracks are generated after play()', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    expect(engine.queue.length).toBeGreaterThan(0);
    expect(engine.queue.every(qi => qi.source === 'radio')).toBe(true);
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

  // ─── Stale Generation Protection ─────────────────────────────────────

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

  // ─── playPreviousTrack ──────────────────────────────────────────────

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

  // ─── Repeat Modes ────────────────────────────────────────────────────

  test('repeat-one: end-file with reason eof does not advance', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;
    engine.addToQueue(makeTrack('X'));

    await engine.setRepeatMode('one');
    player.emit('end-file', { reason: 'eof' });

    expect(engine.currentTrack!.id).toBe('A');
  });

  // ─── playNextTrack ──────────────────────────────────────────────────

  test('playNextTrack() advances to the next track', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    const nextTrackId = engine.queue[0]!.track.id;
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

  // ─── Favorites ──────────────────────────────────────────────────────

  test('toggleFavorite() adds and removes favorites', async () => {
    const track = makeTrack('A');
    const added = engine.toggleFavorite(track);
    expect(added).toBe(true);
    expect(engine.isFavorite('A')).toBe(true);

    const removed = engine.toggleFavorite(track);
    expect(removed).toBe(false);
    expect(engine.isFavorite('A')).toBe(false);
  });

  // ─── Events ─────────────────────────────────────────────────────────

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

  // ─── Queue metadata ─────────────────────────────────────────────────

  test('queue items have correct source tags after play()', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    for (const qi of engine.queue) {
      expect(qi.source).toBe('radio');
    }
  });

  test('queue items have correct source tags after addToQueue()', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    engine.addToQueue(makeTrack('X'));

    const manualItems = engine.queue.filter(qi => qi.source === 'manual');
    expect(manualItems.length).toBe(1);
    expect(manualItems[0]!.track.id).toBe('X');
  });

  test('queue items have correct source tags after playNext()', async () => {
    const refilledPromise = waitForEvent(engine, 'queue-refilled');
    await engine.play(makeTrack('A'));
    await refilledPromise;

    engine.playNext(makeTrack('Y'));

    const manualItems = engine.queue.filter(qi => qi.source === 'manual');
    expect(manualItems.length).toBe(1);
    expect(manualItems[0]!.track.id).toBe('Y');
  });
});
