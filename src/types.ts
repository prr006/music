export interface Track {
  id: string;
  title: string;
  url: string;
  artwork?: string;
  album?: string;
  duration?: number;
  uploader?: string;
}

export interface QueueItem {
  track: Track;
  source: 'manual' | 'radio' | 'playlist';
}

export type RepeatMode = 'off' | 'one' | 'all';

export interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
  createdAt: string;
}
