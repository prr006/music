import { logError } from '../log';
import { runYtdlp } from '../youtube/ytdlp';
import type { Track } from '../types';
import { captionUrlFromDump, parseVtt, type LyricsLine } from './parse-vtt';

export interface LyricsResult {
  trackId: string;
  lines: LyricsLine[];
  source?: string;
}

export interface LyricsProvider {
  lyricsFor(track: Track): Promise<LyricsResult>;
}

export class YoutubeLyrics implements LyricsProvider {
  private readonly cache = new Map<string, LyricsResult>();

  constructor(
    private readonly dump = runYtdlp,
    private readonly fetchText: (url: string) => Promise<string> = defaultFetchText,
  ) {}

  async lyricsFor(track: Track): Promise<LyricsResult> {
    const cached = this.cache.get(track.id);
    if (cached) return cached;
    const empty: LyricsResult = { trackId: track.id, lines: [] };
    try {
      const raw = await this.dump(['-J', '--skip-download', '--no-warnings', track.url]);
      const dump = JSON.parse(raw) as unknown;
      const url = captionUrlFromDump(dump);
      if (!url) {
        this.cache.set(track.id, empty);
        return empty;
      }
      const body = await this.fetchText(url);
      const lines = parseVtt(body);
      const result: LyricsResult = { trackId: track.id, lines, source: 'youtube' };
      this.cache.set(track.id, result);
      return result;
    } catch (error) {
      logError('youtube', error instanceof Error ? error.message : String(error));
      this.cache.set(track.id, empty);
      return empty;
    }
  }
}

async function defaultFetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`lyrics fetch ${response.status}`);
  return response.text();
}
