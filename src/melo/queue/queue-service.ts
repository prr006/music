import type { QueueItem, QueueSource, Track } from '../types';

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
}

export class QueueService {
  private items: QueueItem[] = [];

  snapshot(): QueueItem[] {
    return this.items.slice();
  }

  map<T>(fn: (item: QueueItem, index: number) => T): T[] {
    return this.items.map(fn);
  }

  filter(fn: (item: QueueItem, index: number) => boolean): QueueItem[] {
    return this.items.filter(fn);
  }

  every(fn: (item: QueueItem, index: number) => boolean): boolean {
    return this.items.every(fn);
  }

  some(fn: (item: QueueItem, index: number) => boolean): boolean {
    return this.items.some(fn);
  }

  slice(start?: number, end?: number): QueueItem[] {
    return this.items.slice(start, end);
  }

  [Symbol.iterator](): IterableIterator<QueueItem> {
    return this.items[Symbol.iterator]();
  }

  get length(): number {
    return this.items.length;
  }

  ids(): Set<string> {
    return new Set(this.items.map(item => item.track.id));
  }

  manualCount(): number {
    return this.items.filter(item => item.source === 'manual').length;
  }

  radioCount(): number {
    return this.items.filter(item => item.source === 'radio').length;
  }

  add(track: Track, source: QueueSource = 'manual'): void {
    this.items.push({ track, source });
  }

  insertFront(track: Track, source: QueueSource = 'manual'): void {
    this.items.unshift({ track, source });
  }

  removeAt(index: number): QueueItem | undefined {
    if (index < 0 || index >= this.items.length) return undefined;
    return this.items.splice(index, 1)[0];
  }

  shift(): QueueItem | undefined {
    return this.items.shift();
  }

  clear(): void {
    this.items = [];
  }

  replaceAll(items: QueueItem[]): void {
    this.items = items.slice();
  }

  appendRadio(tracks: Track[]): void {
    const existing = this.ids();
    for (const track of tracks) {
      if (existing.has(track.id)) continue;
      existing.add(track.id);
      this.items.push({ track, source: 'radio' });
    }
  }

  setRadio(tracks: Track[], shuffle = false): void {
    const manual = this.items.filter(item => item.source === 'manual');
    const radio: QueueItem[] = tracks.map(track => ({ track, source: 'radio' as const }));
    if (shuffle) shuffleInPlace(radio);
    this.items = [...manual, ...radio];
  }

  shuffleRadio(): void {
    const manual = this.items.filter(item => item.source === 'manual');
    const radio = this.items.filter(item => item.source !== 'manual');
    shuffleInPlace(radio);
    this.items = [...manual, ...radio];
  }
}
