import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FavoritesService } from '../src/melo/favorites/favorites-service';
import { LibraryService } from '../src/melo/library/library-service';
import { JsonStore } from '../src/melo/persistence/json-store';
import type { Track } from '../src/types';

const configRoot = mkdtempSync(join(tmpdir(), 'melo-config-test-'));

afterAll(() => {
  rmSync(configRoot, { recursive: true, force: true });
});

const track: Track = {
  id: 'track-1',
  title: 'Test Track',
  url: 'https://www.youtube.com/watch?v=track-1',
  duration: 120,
  uploader: 'Test Artist',
};

describe('config persistence', () => {
  test('settings are available immediately after saving', () => {
    const store = new JsonStore(configRoot);
    const library = new LibraryService(store);
    library.saveSettings({ lang: 'az' });
    expect(new LibraryService(store).settings).toEqual({ lang: 'az' });
  });

  test('favorites are available immediately after saving', () => {
    const store = new JsonStore(configRoot);
    const favorites = new FavoritesService(store);
    favorites.toggle(track);
    expect(new FavoritesService(store).snapshot()).toEqual([expect.objectContaining({
      id: 'track-1',
      title: 'Test Track',
      url: track.url,
    })]);
  });

  test('playlists are available immediately after saving', () => {
    const store = new JsonStore(configRoot);
    const library = new LibraryService(store);
    const playlist = library.createPlaylist('Test Playlist');
    library.addToPlaylist(playlist.id, track);
    expect(new LibraryService(store).playlists).toEqual([expect.objectContaining({
      id: playlist.id,
      name: 'Test Playlist',
      tracks: [track],
    })]);
  });

  test('downloads are available immediately after saving', () => {
    const store = new JsonStore(configRoot);
    store.write('downloads.json', [track]);
    expect(new LibraryService(store).downloads).toEqual([track]);
  });
});
