import type { Track } from '../../shared/types';

export type SearchTab = 'all' | 'songs' | 'albums' | 'artists' | 'playlists';

export interface NamedGroup {
  name: string;
  tracks: Track[];
}

export interface PlaylistSummary {
  id: string;
  name: string;
  tracks: Track[];
}

export function groupByArtist(tracks: Track[]): NamedGroup[] {
  const map = new Map<string, Track[]>();
  for (const track of tracks) {
    const name = track.uploader?.trim() || 'Unknown artist';
    const list = map.get(name) ?? [];
    list.push(track);
    map.set(name, list);
  }
  return [...map.entries()].map(([name, grouped]) => ({ name, tracks: grouped }));
}

export function groupByAlbum(tracks: Track[]): NamedGroup[] {
  const map = new Map<string, Track[]>();
  for (const track of tracks) {
    const name = track.album?.trim();
    if (!name) continue;
    const list = map.get(name) ?? [];
    list.push(track);
    map.set(name, list);
  }
  return [...map.entries()].map(([name, grouped]) => ({ name, tracks: grouped }));
}

export function filterPlaylists(playlists: PlaylistSummary[], query: string): PlaylistSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return playlists.filter(playlist => playlist.name.toLowerCase().includes(q));
}
