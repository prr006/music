import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'events';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MeloApp } from '../src/melo/app';
import { createControlHandler } from '../src/melo/ipc/handler';
import { JsonStore } from '../src/melo/persistence/json-store';
import { LibraryService } from '../src/melo/library/library-service';
import type { PlaybackDriver, PlaybackSnapshot, RepeatMode, Track } from '../src/melo/types';
import type { ControlCommand } from '../src/cli';

class MockPlayer extends EventEmitter implements PlaybackDriver {
  snapshot: PlaybackSnapshot = {
    paused: false, muted: false, timePos: 0, duration: 10, volume: 50, repeatMode: 'off',
  };
  async start() {}
  async quit() {}
  async load(_url: string) {}
  async togglePause() { this.snapshot.paused = !this.snapshot.paused; }
  async setPaused(paused: boolean) { this.snapshot.paused = paused; }
  async toggleMute() { this.snapshot.muted = !this.snapshot.muted; return this.snapshot.muted; }
  async seek(_s: number) {}
  async stop() {}
  async setVolume(level: number) { this.snapshot.volume = level; return level; }
  async getVolume() { return this.snapshot.volume; }
  async setRepeatMode(mode: RepeatMode) { this.snapshot.repeatMode = mode; }
}

const sample: Track = { id: 'abc', title: 'Song', url: 'https://www.youtube.com/watch?v=abc' };

describe('settings', () => {
  test('merges unknown old files and ignores fake keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'melo-set-'));
    const store = new JsonStore(dir);
    store.write('settings.json', { lang: 'az', crossfade: true, quality: 'high' });
    const library = new LibraryService(store);
    expect(library.settings.lang).toBe('az');
    expect(library.settings.autoplay).toBe(true);
    expect(library.settings.closeBehavior).toBe('quit');
    expect('crossfade' in library.settings).toBe(false);
    library.saveSettings({ autoplay: false });
    expect(new LibraryService(store).settings.autoplay).toBe(false);
    expect(new LibraryService(store).settings.lang).toBe('az');
  });

  test('handler playlists lyrics queue move and settings', async () => {
    const app = new MeloApp({
      playback: new MockPlayer(),
      search: { search: async () => [sample] },
      radio: { related: async () => [] },
      resolver: { resolveAudioUrl: async track => track.url },
      lyrics: { lyricsFor: async track => ({ trackId: track.id, lines: [{ text: 'hi', startMs: 0 }] }) },
      store: new JsonStore(mkdtempSync(join(tmpdir(), 'melo-hset-'))),
    });
    const handle = createControlHandler(app, () => {});
    const created = await handle({ type: 'create-playlist', name: 'Mix' } as ControlCommand);
    expect(created.ok).toBe(true);
    const extra = { ...sample, id: 'def', title: 'Next' };
    await handle({ type: 'play-track', track: sample } as ControlCommand);
    await handle({ type: 'add-to-queue', track: extra } as ControlCommand);
    await handle({ type: 'add-to-queue', track: { ...sample, id: 'ghi', title: 'Third' } } as ControlCommand);
    const moved = await handle({ type: 'move-queue', from: 0, to: 1 } as ControlCommand);
    expect(moved.ok).toBe(true);
    const lyrics = await handle({ type: 'get-lyrics' } as ControlCommand);
    expect((lyrics.data as { lines: { text: string }[] }).lines[0]?.text).toBe('hi');
    const saved = await handle({ type: 'save-settings', settings: { autoplay: false, closeBehavior: 'tray' } } as ControlCommand);
    expect(saved.ok).toBe(true);
    expect((saved.data as { autoplay: boolean; closeBehavior: string }).autoplay).toBe(false);
    expect((saved.data as { closeBehavior: string }).closeBehavior).toBe('tray');
  });
});
