import type { Track } from '../types';
import type { JsonStore } from '../persistence/json-store';

const MAX = 200;

interface HistoryRecord {
  track: Track;
  playedAt: number;
}

/**
 * One store for recently played and Previous.
 * Records are chronological (oldest → newest). Previous pops the newest.
 * snapshot() is newest-first for Recently Played.
 */
export class HistoryService {
  private records: HistoryRecord[] = [];
  private sessionIds = new Set<string>();

  constructor(private readonly store: JsonStore) {
    const raw = this.store.read<HistoryRecord[] | Track[]>('history.json', []);
    this.records = this.normalize(raw);
  }

  /** Recently played, newest first. Previous uses the same newest entry. */
  snapshot(): Track[] {
    const tracks: Track[] = [];
    for (let i = this.records.length - 1; i >= 0; i--) {
      const record = this.records[i];
      if (record) tracks.push(record.track);
    }
    return tracks;
  }

  record(track: Track): void {
    if (!track?.id) return;
    if (this.sessionIds.has(track.id)) return;
    this.sessionIds.add(track.id);

    const last = this.records[this.records.length - 1];
    if (last?.track.id === track.id) return;

    this.records.push({
      track: {
        id: track.id,
        title: track.title,
        url: track.url,
        artwork: track.artwork,
        album: track.album,
        duration: track.duration,
        uploader: track.uploader,
      },
      playedAt: Date.now(),
    });

    if (this.records.length > MAX) {
      this.records = this.records.slice(-MAX);
    }
    this.store.write('history.json', this.records);
  }

  /** Previous track: newest recently-played entry, removed from the list. */
  pop(): Track | undefined {
    const record = this.records.pop();
    if (!record) return undefined;
    this.sessionIds.delete(record.track.id);
    this.store.write('history.json', this.records);
    return record.track;
  }

  clearSession(): void {
    this.sessionIds.clear();
  }

  /** Clears recently played and the previous-track stack together. */
  clear(): void {
    this.records = [];
    this.sessionIds.clear();
    this.store.write('history.json', this.records);
  }

  private normalize(raw: HistoryRecord[] | Track[]): HistoryRecord[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap(item => {
      if (item && typeof item === 'object' && 'track' in item && (item as HistoryRecord).track?.id) {
        return [item as HistoryRecord];
      }
      const track = item as Track;
      if (track && typeof track.id === 'string') {
        return [{ track, playedAt: 0 }];
      }
      return [];
    });
  }
}
