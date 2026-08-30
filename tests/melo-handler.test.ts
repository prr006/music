import { describe, expect, test, beforeEach } from 'bun:test';
import { EventEmitter } from 'events';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MeloApp } from '../src/melo/app';
import { createControlHandler } from '../src/melo/ipc/handler';
import { JsonStore } from '../src/melo/persistence/json-store';
import type { PlaybackDriver, PlaybackSnapshot, RepeatMode, Track } from '../src/melo/types';
import type { ControlCommand } from '../src/cli';

class MockPlayer extends EventEmitter implements PlaybackDriver {
  snapshot: PlaybackSnapshot = {
    paused: false,
    muted: false,
    timePos: 12,
    duration: 200,
    volume: 80,
    repeatMode: 'off',
  };
  async start() {}
  async quit() {}
  async load(_url: string) {}
  async togglePause() { this.snapshot.paused = !this.snapshot.paused; }
  async setPaused(paused: boolean) { this.snapshot.paused = paused; }
  async toggleMute() { this.snapshot.muted = !this.snapshot.muted; return this.snapshot.muted; }
  async seek(_s: number) {}
  async stop() {}
  async setVolume(level: number) {
    this.snapshot.volume = Math.max(0, Math.min(100, Math.round(level)));
    return this.snapshot.volume;
  }
  async getVolume() { return this.snapshot.volume; }
  async setRepeatMode(mode: RepeatMode) { this.snapshot.repeatMode = mode; }
}

const sample: Track = {
  id: 'abc',
  title: 'Song',
  url: 'https://www.youtube.com/watch?v=abc',
  uploader: 'Artist',
  artwork: 'https://i.ytimg.com/vi/abc/mqdefault.jpg',
};

describe('control handler', () => {
  let app: MeloApp;
  let handle: ReturnType<typeof createControlHandler>;

  beforeEach(() => {
    app = new MeloApp({
      playback: new MockPlayer(),
      search: {
        search: async (query: string) => query.includes('none') ? [] : [sample],
      },
      radio: { related: async () => [] },
      resolver: { resolveAudioUrl: async track => track.url },
      store: new JsonStore(mkdtempSync(join(tmpdir(), 'melo-handler-'))),
    });
    handle = createControlHandler(app, () => {});
  });

  test('search returns tracks as data', async () => {
    const response = await handle({ type: 'search', query: 'hello', limit: 5 } as ControlCommand);
    expect(response.ok).toBe(true);
    expect(response.data).toEqual([sample]);
  });

  test('search empty query is safe', async () => {
    const response = await handle({ type: 'search', query: '  ', limit: 5 } as ControlCommand);
    expect(response.ok).toBe(true);
    expect(response.data).toEqual([]);
  });

  test('play-track and get-state', async () => {
    const play = await handle({ type: 'play-track', track: sample } as ControlCommand);
    expect(play.ok).toBe(true);
    const state = await handle({ type: 'get-state' } as ControlCommand);
    expect(state.ok).toBe(true);
    expect((state.data as { currentTrack: Track }).currentTrack.id).toBe('abc');
  });

  test('queue commands', async () => {
    await handle({ type: 'play-track', track: sample } as ControlCommand);
    const extra: Track = { ...sample, id: 'def', title: 'Next' };
    const added = await handle({ type: 'add-to-queue', track: extra } as ControlCommand);
    expect(added.ok).toBe(true);
    const queue = await handle({ type: 'get-queue' } as ControlCommand);
    expect((queue.data as { track: Track }[]).map(item => item.track.id)).toEqual(['def']);
    const next = await handle({ type: 'play-next', track: { ...sample, id: 'zzz', title: 'Soon' } } as ControlCommand);
    expect(next.ok).toBe(true);
    const after = await handle({ type: 'get-queue' } as ControlCommand);
    expect((after.data as { track: Track }[])[0]!.track.id).toBe('zzz');
  });

  test('pause without a track fails safely', async () => {
    const response = await handle({ type: 'pause' } as ControlCommand);
    expect(response.ok).toBe(false);
    expect(response.message).toContain('Nothing is playing');
  });

  test('unknown command does not throw', async () => {
    const response = await handle({ type: 'explode-disk' } as unknown as ControlCommand);
    expect(response.ok).toBe(false);
  });
});
