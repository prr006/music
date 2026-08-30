import type { Track } from '../types';
import type { JsonStore } from '../persistence/json-store';

export class FavoritesService {
  private items: Track[] = [];

  constructor(private readonly store: JsonStore) {
    this.items = this.normalize(this.store.read<Track[]>('favorites.json', []));
  }

  snapshot(): Track[] {
    return this.items.slice();
  }

  has(id: string): boolean {
    return this.items.some(track => track.id === id);
  }

  toggle(track: Track): boolean {
    const idx = this.items.findIndex(item => item.id === track.id);
    if (idx >= 0) {
      this.items.splice(idx, 1);
      this.persist();
      return false;
    }
    this.items.push(this.compact(track));
    this.persist();
    return true;
  }

  private persist() {
    this.store.write('favorites.json', this.items);
  }

  private normalize(raw: Track[]): Track[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(item => item && typeof item.id === 'string' && typeof item.title === 'string');
  }

  private compact(track: Track): Track {
    return {
      id: track.id,
      title: track.title,
      url: track.url,
      artwork: track.artwork,
      album: track.album,
      duration: track.duration,
      uploader: track.uploader,
    };
  }
}
