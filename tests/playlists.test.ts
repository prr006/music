import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LibraryService } from '../src/melo/library/library-service';
import { JsonStore } from '../src/melo/persistence/json-store';
import type { Track } from '../src/melo/types';

const a: Track = { id: 'a', title: 'A', url: 'https://www.youtube.com/watch?v=a' };
const b: Track = { id: 'b', title: 'B', url: 'https://www.youtube.com/watch?v=b' };
const c: Track = { id: 'c', title: 'C', url: 'https://www.youtube.com/watch?v=c' };

describe('playlists', () => {
  test('create rename reorder persist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'melo-pl-'));
    const library = new LibraryService(new JsonStore(dir));
    const playlist = library.createPlaylist('  Mix  ');
    expect(playlist.name).toBe('Mix');
    library.addToPlaylist(playlist.id, a);
    library.addToPlaylist(playlist.id, b);
    library.addToPlaylist(playlist.id, c);
    expect(library.addToPlaylist(playlist.id, a)).toBe(false);
    expect(library.reorderPlaylist(playlist.id, 0, 2)).toBe(true);
    expect(library.playlistById(playlist.id)?.tracks.map(t => t.id)).toEqual(['b', 'c', 'a']);
    library.renamePlaylist(playlist.id, 'Night');
    const again = new LibraryService(new JsonStore(dir));
    expect(again.playlists[0]?.name).toBe('Night');
    expect(again.playlists[0]?.tracks.map(t => t.id)).toEqual(['b', 'c', 'a']);
  });
});
