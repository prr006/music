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

// ─── Control Protocol (shared between GUI and backend) ────────────────────
// This type must stay in sync with src/cli.ts ControlCommand.
// Any change here or in the backend MUST be mirrored on the other side.

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
  | { type: 'favorite' }
  | { type: 'download' }
  | { type: 'queue'; clear: boolean }
  | { type: 'stop' }
  | { type: 'quit' }
  | { type: 'search'; query: string; limit?: number }
  // Extended protocol (GUI integration)
  | { type: 'add-to-queue'; track: Track }
  | { type: 'play-next'; track: Track }
  | { type: 'remove-from-queue'; index: number }
  | { type: 'get-queue' }
  | { type: 'get-state' }
  | { type: 'subscribe' };

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

export interface EngineState {
  currentTrack: Track | null;
  queue: QueueItem[];
  history: Track[];
  volume: number;
  muted: boolean;
  paused: boolean;
  timePos: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

export interface BackendEvent {
  type: string;
  [key: string]: unknown;
}

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
