export type RepeatMode = 'off' | 'one' | 'all';
export type QueueSource = 'manual' | 'radio' | 'playlist';

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
  source: QueueSource;
}

export interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
  createdAt: string;
}

export interface PlaybackSnapshot {
  paused: boolean;
  muted: boolean;
  timePos: number;
  duration: number;
  volume: number;
  repeatMode: RepeatMode;
}

export interface AppSettings {
  lang: string;
  autoplay: boolean;
  closeBehavior: 'quit' | 'tray';
  startMinimized: boolean;
  minimizeToTray: boolean;
  miniAlwaysOnTop: boolean;
}

export interface AppState {
  currentTrack: Track | null;
  queue: QueueItem[];
  history: Track[];
  favorites: Track[];
  volume: number;
  muted: boolean;
  paused: boolean;
  timePos: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  playlists: Playlist[];
  downloads: Track[];
  settings: AppSettings;
}

export type MeloEvent =
  | { type: 'track-changed'; track: Track | null }
  | { type: 'playback-state'; track: Track | null; playing: boolean; position: number; duration: number; volume: number; muted: boolean; shuffle: boolean; repeat: RepeatMode }
  | { type: 'queue-changed'; queue: QueueItem[]; manualCount: number; radioCount: number }
  | { type: 'queue-refilled'; queue: QueueItem[]; manualCount: number; radioCount: number }
  | { type: 'volume-changed'; volume: number; muted: boolean }
  | { type: 'shuffle-changed'; enabled: boolean }
  | { type: 'repeat-changed'; mode: RepeatMode }
  | { type: 'favorites-changed'; favorites: Track[] }
  | { type: 'playlists-changed'; playlists: Playlist[] }
  | { type: 'history-changed'; history: Track[] }
  | { type: 'settings-changed'; settings: AppSettings }
  | { type: 'download-started'; trackId: string }
  | { type: 'download-completed'; track: Track }
  | { type: 'download-removed'; trackId: string }
  | { type: 'error'; message: string; area: string };

export interface SearchProvider {
  search(query: string, limit?: number): Promise<Track[]>;
}

export interface RadioProvider {
  related(videoId: string, limit?: number): Promise<Track[]>;
}

export interface SourceResolver {
  resolveAudioUrl(track: Track): Promise<string>;
}

export interface PlaybackDriver {
  readonly snapshot: PlaybackSnapshot;
  start(): Promise<void>;
  quit(): Promise<void>;
  load(url: string): Promise<void>;
  togglePause(): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  toggleMute(): Promise<boolean>;
  seek(seconds: number): Promise<void>;
  stop(): Promise<void>;
  setVolume(level: number): Promise<number>;
  getVolume(): Promise<number>;
  setRepeatMode(mode: RepeatMode): Promise<void>;
  on(event: 'end-file', listener: (info: { reason: string }) => void): this;
  on(event: 'state', listener: () => void): this;
  on(event: 'unexpected-exit', listener: (error: Error) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
}
