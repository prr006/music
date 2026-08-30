import { log, logError } from '../log';
import type { SourceResolver, Track } from '../types';
import { youtubeWatchUrl } from './parse';
import { runYtdlp } from './ytdlp';

export class YoutubeResolver implements SourceResolver {
  async resolveAudioUrl(track: Track): Promise<string> {
    const url = track.url || youtubeWatchUrl(track.id);
    log('youtube', `resolve ${track.id}`);

    try {
      const text = await runYtdlp([
        '-f', 'bestaudio/best',
        '-g',
        '--no-playlist',
        '--quiet',
        url,
      ]);
      const stream = text.split('\n').map(line => line.trim()).find(Boolean);
      if (!stream) throw new Error('No playable stream URL returned.');
      return stream;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError('youtube', `resolve failed for ${track.id}: ${message}`);
      throw new Error(`Could not resolve YouTube audio for ${track.id}.`);
    }
  }
}
