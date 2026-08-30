import { log, logError } from '../log';
import type { SearchProvider, Track } from '../types';
import { parseDumpLines } from '../youtube/parse';
import { runYtdlp } from '../youtube/ytdlp';

export class YoutubeSearch implements SearchProvider {
  async search(query: string, limit = 8): Promise<Track[]> {
    const q = query.trim();
    if (!q) return [];

    const capped = Math.max(1, Math.min(limit, 25));
    log('search', `query="${q}" limit=${capped}`);

    try {
      const text = await runYtdlp([
        `ytsearch${capped}:${q}`,
        '--dump-json',
        '--flat-playlist',
        '--quiet',
      ]);
      const tracks = parseDumpLines(text);
      log('search', `results=${tracks.length}`);
      return tracks;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError('search', message);
      throw new Error(`YouTube search failed: ${message}`);
    }
  }
}
