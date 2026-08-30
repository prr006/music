import type { Track } from '../../shared/types';
import { artworkFor } from './media';

export interface MediaSessionActions {
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
}

export function syncMediaSession(
  track: Track | null,
  playing: boolean,
  actions: MediaSessionActions,
): () => void {
  const session = navigator.mediaSession;
  if (!session) return () => {};

  if (!track) {
    session.metadata = null;
    session.playbackState = 'none';
    return () => {};
  }

  session.metadata = new MediaMetadata({
    title: track.title,
    artist: track.uploader || 'Unknown',
    album: track.album || '',
    artwork: [{ src: artworkFor(track, true), sizes: '320x180', type: 'image/jpeg' }],
  });
  session.playbackState = playing ? 'playing' : 'paused';

  // Play/pause/next/prev are handled by Electron globalShortcut so a headset
  // key cannot toggle twice. Seek is renderer-only.
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['seekbackward', details => actions.seek(-(details.seekOffset || 10))],
    ['seekforward', details => actions.seek(details.seekOffset || 10)],
  ];
  for (const [action, handler] of handlers) {
    try { session.setActionHandler(action, handler); } catch { /* unsupported */ }
  }

  return () => {
    for (const [action] of handlers) {
      try { session.setActionHandler(action, null); } catch { /* ignore */ }
    }
  };
}
