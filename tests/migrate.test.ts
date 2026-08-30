import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { migrateUserData } from '../src/melo/persistence/migrate';
import { getConfigDir, getControlIpcPath, getMusicDir } from '../src/platform';

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `melo-migrate-${label}-`));
}

function write(dir: string, name: string, body: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body);
}

describe('legacy user data migration', () => {
  test('copies missing config files and downloads without deleting the legacy dirs', () => {
    const configFrom = tempDir('cfg-from');
    const configTo = tempDir('cfg-to');
    const musicFrom = tempDir('music-from');
    const musicTo = tempDir('music-to');

    write(configFrom, 'favorites.json', '[{"id":"a"}]');
    write(configFrom, 'history.json', '[{"id":"h"}]');
    write(configFrom, 'playlists.json', '[]');
    write(configFrom, 'downloads.json', '[]');
    write(configFrom, 'settings.json', '{"lang":"en"}');
    write(configFrom, 'notes.txt', 'ignore me');
    write(musicFrom, 'a.mp3', 'audio');

    const first = migrateUserData({ configFrom, configTo, musicFrom, musicTo });
    expect(first.configCopied.sort()).toEqual([
      'downloads.json',
      'favorites.json',
      'history.json',
      'playlists.json',
      'settings.json',
    ]);
    expect(first.musicCopied).toEqual(['a.mp3']);
    expect(readFileSync(join(configTo, 'favorites.json'), 'utf8')).toBe('[{"id":"a"}]');
    expect(existsSync(join(configTo, 'notes.txt'))).toBe(false);
    expect(readFileSync(join(musicTo, 'a.mp3'), 'utf8')).toBe('audio');
    expect(existsSync(join(configFrom, 'favorites.json'))).toBe(true);
    expect(existsSync(join(musicFrom, 'a.mp3'))).toBe(true);

    write(configTo, 'favorites.json', '[{"id":"keep"}]');
    write(musicTo, 'a.mp3', 'keep-audio');
    write(configFrom, 'favorites.json', '[{"id":"new"}]');

    const second = migrateUserData({ configFrom, configTo, musicFrom, musicTo });
    expect(second.configCopied).toEqual([]);
    expect(second.musicCopied).toEqual([]);
    expect(readFileSync(join(configTo, 'favorites.json'), 'utf8')).toBe('[{"id":"keep"}]');
    expect(readFileSync(join(musicTo, 'a.mp3'), 'utf8')).toBe('keep-audio');
  });

  test('copies only files that are missing in the destination', () => {
    const configFrom = tempDir('partial-from');
    const configTo = tempDir('partial-to');
    write(configFrom, 'favorites.json', 'legacy');
    write(configFrom, 'settings.json', 'legacy-settings');
    write(configTo, 'favorites.json', 'melo');

    const result = migrateUserData({
      configFrom,
      configTo,
      musicFrom: tempDir('empty-music-from'),
      musicTo: tempDir('empty-music-to'),
    });

    expect(result.configCopied).toEqual(['settings.json']);
    expect(readFileSync(join(configTo, 'favorites.json'), 'utf8')).toBe('melo');
    expect(readFileSync(join(configTo, 'settings.json'), 'utf8')).toBe('legacy-settings');
  });

  test('user data and control socket use the MELO identity only', () => {
    expect(getConfigDir().replace(/\\/g, '/')).toMatch(/\/melo$/);
    expect(getMusicDir().replace(/\\/g, '/')).toMatch(/\/melo$/);

    const previous = process.env.MELO_CONTROL_SOCKET;
    const legacy = process.env.YTMUSIC_CONTROL_SOCKET;
    process.env.MELO_CONTROL_SOCKET = '';
    process.env.YTMUSIC_CONTROL_SOCKET = '/tmp/legacy-ytmusic.sock';
    try {
      expect(getControlIpcPath()).not.toContain('legacy-ytmusic');
      process.env.MELO_CONTROL_SOCKET = '/tmp/melo-test.sock';
      expect(getControlIpcPath()).toBe('/tmp/melo-test.sock');
    } finally {
      if (previous === undefined) delete process.env.MELO_CONTROL_SOCKET;
      else process.env.MELO_CONTROL_SOCKET = previous;
      if (legacy === undefined) delete process.env.YTMUSIC_CONTROL_SOCKET;
      else process.env.YTMUSIC_CONTROL_SOCKET = legacy;
    }
  });
});
