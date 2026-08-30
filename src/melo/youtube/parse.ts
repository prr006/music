import type { Track } from '../types';

export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function thumbnailFor(id: string, dump?: Record<string, unknown>): string | undefined {
  const direct = dump?.thumbnail;
  if (typeof direct === 'string' && direct) return direct;

  const thumbs = dump?.thumbnails;
  if (Array.isArray(thumbs) && thumbs.length > 0) {
    const last = thumbs[thumbs.length - 1] as { url?: string } | undefined;
    if (last?.url) return last.url;
  }

  if (id) return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  return undefined;
}

export function trackFromDump(dump: Record<string, unknown>): Track | null {
  const id = typeof dump.id === 'string' ? dump.id : '';
  const title = typeof dump.title === 'string' ? dump.title : '';
  if (!id || !title) return null;

  const duration = typeof dump.duration === 'number' ? dump.duration : undefined;
  const uploader =
    (typeof dump.uploader === 'string' && dump.uploader)
    || (typeof dump.channel === 'string' && dump.channel)
    || undefined;

  return {
    id,
    title,
    url: youtubeWatchUrl(id),
    duration,
    uploader,
    artwork: thumbnailFor(id, dump),
  };
}

export function parseDumpLines(text: string): Track[] {
  const tracks: Track[] = [];
  const seen = new Set<string>();

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const dump = JSON.parse(line) as Record<string, unknown>;
      const track = trackFromDump(dump);
      if (!track || seen.has(track.id)) continue;
      seen.add(track.id);
      tracks.push(track);
    } catch {
      continue;
    }
  }

  return tracks;
}
