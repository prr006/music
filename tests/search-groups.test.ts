import { describe, expect, test } from 'bun:test';
import { filterPlaylists, groupByAlbum, groupByArtist } from '../gui/src/renderer/lib/search-groups';
import type { Track } from '../src/melo/types';

const tracks: Track[] = [
  { id: '1', title: 'One', url: 'https://www.youtube.com/watch?v=1', uploader: 'A', album: 'Alpha' },
  { id: '2', title: 'Two', url: 'https://www.youtube.com/watch?v=2', uploader: 'A', album: 'Alpha' },
  { id: '3', title: 'Three', url: 'https://www.youtube.com/watch?v=3', uploader: 'B' },
];

describe('search grouping', () => {
  test('groups by existing uploader and album fields only', () => {
    expect(groupByArtist(tracks).map(g => [g.name, g.tracks.length])).toEqual([['A', 2], ['B', 1]]);
    expect(groupByAlbum(tracks).map(g => g.name)).toEqual(['Alpha']);
  });

  test('does not invent albums when the field is missing', () => {
    expect(groupByAlbum([tracks[2]!])).toEqual([]);
  });

  test('filters playlists by name', () => {
    const found = filterPlaylists([
      { id: 'p1', name: 'Night Drive', tracks },
      { id: 'p2', name: 'Focus', tracks: [] },
    ], 'night');
    expect(found.map(p => p.id)).toEqual(['p1']);
  });
});
