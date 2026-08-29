import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Track } from '../src/types';

const configRoot = mkdtempSync(join(tmpdir(), 'ytmusic-player-config-test-'));
const previousConfigHome = process.env.XDG_CONFIG_HOME;
process.env.XDG_CONFIG_HOME = configRoot;

const config = await import(`../src/config.ts?test=${Date.now()}`);

afterAll(() => {
  if (previousConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = previousConfigHome;
  }
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
    config.saveSettings({ lang: 'az' });
    expect(config.loadSettings()).toEqual({ lang: 'az' });
  });

  test('favorites are available immediately after saving', () => {
    config.saveFavorites([track]);
    expect(config.loadFavorites()).toEqual([track]);
  });

  test('playlists are available immediately after saving', () => {
    const playlists = [{
      id: 'playlist-1',
      name: 'Test Playlist',
      tracks: [track],
      createdAt: '2026-07-21T00:00:00.000Z',
    }];
    config.savePlaylists(playlists);
    expect(config.loadPlaylists()).toEqual(playlists);
  });

  test('downloads are available immediately after saving', () => {
    config.saveDownloads([track]);
    expect(config.loadDownloads()).toEqual([track]);
  });
});
