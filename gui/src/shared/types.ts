// ─── Shared Types ─────────────────────────────────────────────────────────

export interface Track {
  id: string;
  title: string;
  url: string;
  artwork?: string;
  album?: string;
  duration?: number;
  uploader?: string;
}

// ─── Control Protocol (shared between renderer and backend) ───────────────
// This type must stay in sync with the Rust backend command surface
// (lightweight/src-tauri/src/commands.rs). Any change here or in the backend
// MUST be mirrored on the other side.

export type ControlCommand =
  | { type: 'play'; query: string }
  | { type: 'play-track'; track: Track }
  | { type: 'mute' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'toggle' }
  | { type: 'volume'; value: number; relative: boolean }
  | { type: 'seek'; seconds: number }
  | { type: 'now' }
  | { type: 'status' }
  | { type: 'shuffle'; enabled: boolean | null }
  | { type: 'repeat'; mode: RepeatMode }
  | { type: 'favorite'; track?: Track }
  | { type: 'download' }
  | { type: 'queue'; clear: boolean }
  | { type: 'stop' }
  | { type: 'quit' }
  | { type: 'search'; query: string; limit?: number }
  // Extended protocol (GUI integration)
  | { type: 'add-to-queue'; track: Track }
  | { type: 'play-next'; track: Track }
  | { type: 'remove-from-queue'; index: number }
  | { type: 'move-queue'; from: number; to: number }
  | { type: 'play-from-queue'; index: number }
  | { type: 'get-queue' }
  | { type: 'get-state' }
  | { type: 'subscribe' }
  | { type: 'get-lyrics'; track?: Track }
  | { type: 'get-playlists' }
  | { type: 'create-playlist'; name: string }
  | { type: 'delete-playlist'; id: string }
  | { type: 'rename-playlist'; id: string; name: string }
  | { type: 'add-to-playlist'; id: string; track: Track }
  | { type: 'remove-from-playlist'; id: string; index: number }
  | { type: 'reorder-playlist'; id: string; from: number; to: number }
  | { type: 'play-playlist'; id: string; index?: number }
  | { type: 'save-queue-as-playlist'; name: string }
  | { type: 'clear-history' }
  | { type: 'get-settings' }
  | { type: 'save-settings'; settings: Record<string, unknown> };

/** Response from the backend control socket. */
export interface ControlResponse {
  ok: boolean;
  message: string;
  data?: unknown;
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

export interface AppSettings {
  lang: string;
  autoplay: boolean;
  closeBehavior: 'quit' | 'tray';
  startMinimized: boolean;
  minimizeToTray: boolean;
  miniAlwaysOnTop: boolean;
}

export interface LyricsLine {
  text: string;
  startMs?: number;
}

export interface LyricsResult {
  trackId: string;
  lines: LyricsLine[];
  source?: string;
}

export interface EngineState {
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

export type BackendEvent =
  | { type: 'track-changed'; track: Track | null }
  | { type: 'playback-state'; track: Track | null; playing: boolean; position: number; duration: number; volume: number; muted: boolean; shuffle: boolean; repeat: RepeatMode }
  | { type: 'queue-changed'; queue: QueueItem[]; manualCount?: number; radioCount?: number }
  | { type: 'queue-refilled'; queue: QueueItem[]; manualCount?: number; radioCount?: number }
  | { type: 'volume-changed'; volume: number; muted: boolean }
  | { type: 'shuffle-changed'; enabled: boolean }
  | { type: 'repeat-changed'; mode: RepeatMode }
  | { type: 'favorites-changed'; favorites: Track[] }
  | { type: 'playlists-changed'; playlists: Playlist[] }
  | { type: 'history-changed'; history: Track[] }
  | { type: 'settings-changed'; settings: AppSettings };

// ─── IPC API (renderer → main → backend) ──────────────────────────────────

export interface IpcApi {
  // Send any command to the backend
  sendCommand(command: Record<string, unknown>): Promise<{ ok: boolean; message: string; data?: unknown }>;

  // Event listeners
  onEvent(callback: (event: BackendEvent) => void): () => void;
  onConnected(callback: (connected: boolean) => void): () => void;

  // Connection status
  isConnected(): Promise<boolean>;
}
