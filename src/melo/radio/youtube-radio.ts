import { log, logError } from '../log';
import type { RadioProvider, Track } from '../types';
import { parseDumpLines } from '../youtube/parse';
import { runYtdlp } from '../youtube/ytdlp';

export class YoutubeRadio implements RadioProvider {
  async related(videoId: string, limit = 25): Promise<Track[]> {
    if (!videoId) return [];
    const capped = Math.max(1, Math.min(limit, 40));
    const url = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
    log('radio', `related for ${videoId} limit=${capped}`);

    try {
      const text = await runYtdlp([
        url,
        '--dump-json',
        '--flat-playlist',
        '--quiet',
        '--playlist-end',
        String(capped),
      ]);
      const tracks = parseDumpLines(text).filter(track => track.id !== videoId);
      log('radio', `related results=${tracks.length}`);
      return tracks;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError('radio', `related failed for ${videoId}: ${message}`);
      return [];
    }
  }
}
