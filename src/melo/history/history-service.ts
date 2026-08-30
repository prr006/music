import type { Track } from '../types';
import type { JsonStore } from '../persistence/json-store';

const MAX = 200;

interface HistoryRecord {
  track: Track;
  playedAt: number;
}

export class HistoryService {
  private records: HistoryRecord[] = [];
  private sessionIds = new Set<string>();

  constructor(private readonly store: JsonStore) {
    const raw = this.store.read<HistoryRecord[] | Track[]>('history.json', []);
    this.records = this.normalize(raw);
  }

  snapshot(): Track[] {
    return this.records.map(record => record.track);
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
