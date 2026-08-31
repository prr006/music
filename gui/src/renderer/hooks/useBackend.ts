import { useState, useEffect, useCallback, useRef } from 'react';
import type { Track, QueueItem, RepeatMode, ControlCommand, ControlResponse, Playlist, AppSettings, LyricsResult } from '../../shared/types';

const DEFAULT_SETTINGS: AppSettings = {
  lang: 'en',
  autoplay: true,
  closeBehavior: 'quit',
  startMinimized: false,
  minimizeToTray: false,
  miniAlwaysOnTop: true,
};

// ─── Types ────────────────────────────────────────────────────────────────

export type ConnectionState = 'starting' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface PlayerState {
  connected: boolean;
  connectionState: ConnectionState;
  currentTrack: Track | null;
  playing: boolean;
  loading: boolean;       // true between click-Play and track-changed
  loadingTrack: Track | null; // the track we're waiting for
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  queue: QueueItem[];
  history: Track[];
  favorites: Track[];
  searchResults: Track[];
  searching: boolean;
  error: string | null;
  playlists: Playlist[];
  downloads: Track[];
  settings: AppSettings;
  lyrics: LyricsResult | null;
  lyricsLoading: boolean;
}

declare global {
  interface Window {
    api: {
      sendCommand(command: ControlCommand): Promise<ControlResponse>;
      isConnected(): Promise<boolean>;
      getConnectionState(): Promise<string>;
      retryBackend(): Promise<void>;
      onEvent(callback: (event: unknown) => void): () => void;
      onConnectionState(callback: (state: string) => void): () => void;
      onConnected(callback: (connected: boolean) => void): () => void;
      // Window controls
      windowMinimize?(): void;
      windowMaximize?(): void;
      windowClose?(): void;
      windowIsMaximized?(): Promise<boolean>;
      onWindowMaximized?(callback: (maximized: boolean) => void): () => void;
      toggleMiniPlayer?(): Promise<boolean>;
      setMiniAlwaysOnTop?(value: boolean): Promise<void>;
      setCloseBehavior?(value: 'quit' | 'tray'): Promise<void>;
      setMinimizeToTray?(value: boolean): Promise<void>;
      showMainWindow?(): void;
    };
  }
}


// ─── Hook ─────────────────────────────────────────────────────────────────

export function useBackend() {
  const [s, set] = useState<PlayerState>({
    connected: false,
    connectionState: 'starting',
    currentTrack: null,
    playing: false,
    loading: false,
    loadingTrack: null,
    position: 0,
    duration: 0,
    volume: 100,
    muted: false,
    shuffle: false,
    repeat: 'off',
    queue: [],
    history: [],
    favorites: [],
    searchResults: [],
    searching: false,
    error: null,
    playlists: [],
    downloads: [],
    settings: DEFAULT_SETTINGS,
    lyrics: null,
    lyricsLoading: false,
  });

  const sRef = useRef(s);
  sRef.current = s;

  // ─── Connection ──────────────────────────────────────────────────────

  useEffect(() => {
    let disposed = false;

    // A connection event can occur before React registers its listeners. Read the
    // current status too, so the initial screen always hydrates correctly.
    void window.api.getConnectionState().then((rawState) => {
      if (disposed) return;
      const cs = rawState as ConnectionState;
      const isConnected = cs === 'connected';
      set(p => ({ ...p, connectionState: cs, connected: isConnected }));
      if (isConnected) {
        fetchState();
        fetchQueue();
      }
    }).catch(() => {});

    // New: detailed connection state
    const unsubState = window.api.onConnectionState((state) => {
      const cs = state as ConnectionState;
      const isConnected = cs === 'connected';
      set(p => ({ ...p, connectionState: cs, connected: isConnected }));
      if (isConnected) {
        fetchState();
        fetchQueue();
      }
    });

    // Legacy: also listen for boolean connected/disconnected
    const unsubLegacy = window.api.onConnected((connected) => {
      set(p => ({ ...p, connected, connectionState: connected ? 'connected' : 'disconnected' }));
      if (connected) {
        fetchState();
        fetchQueue();
      }
    });

    return () => {
      disposed = true;
      unsubState();
      unsubLegacy();
    };
  }, []);

  // ─── Event handling ──────────────────────────────────────────────────

  useEffect(() => {
    const unsub = window.api.onEvent((raw) => {
      const e = raw as { type: string; [k: string]: unknown };

      switch (e.type) {
        case 'playback-state': {
          // Authoritative position/volume. Loading stays until track-changed
          // or the new stream actually starts (playing === true).
          const track = e.track as Track | null;
          const playing = e.playing as boolean;
          set(p => {
            // Reject stale events from a previous track. While we are loading,
            // only the track we are waiting for may update state; once loaded,
            // only the track shown as current may update it.
            const expectedId = p.loading
              ? p.loadingTrack?.id
              : p.currentTrack?.id;
            if (track && expectedId && track.id !== expectedId) {
              return p;
            }
            // A trackless event is only meaningful when nothing should be
            // active; drop it if we are still showing a track.
            if (!track && p.currentTrack) {
              return p;
            }
            return {
              ...p,
              currentTrack: track ?? p.currentTrack,
              playing: p.loading ? false : playing,
              position: p.loading ? 0 : ((e.position as number) ?? 0),
              duration: (e.duration as number) ?? p.duration,
              volume: (e.volume as number) ?? p.volume,
              muted: (e.muted as boolean) ?? p.muted,
              shuffle: (e.shuffle as boolean) ?? p.shuffle,
              repeat: (e.repeat as RepeatMode) ?? p.repeat,
              loading: p.loading && !playing,
              loadingTrack: p.loading && !playing ? p.loadingTrack : null,
            };
          });
          break;
        }
        case 'track-changed': {
          const track = e.track as Track | null;
          set(p => {
            // Add previous track to history (if different from new track)
            const newHistory = p.currentTrack && track && p.currentTrack.id !== track.id
              ? [p.currentTrack, ...p.history.filter(h => h.id !== p.currentTrack!.id)].slice(0, 50)
              : p.history;
            if (!track) {
              return {
                ...p,
                currentTrack: null,
                playing: false,
                loading: false,
                loadingTrack: null,
                position: 0,
                duration: 0,
                history: newHistory,
              };
            }
            // Do not show a new track as ready until mpv reports it is actually
            // playing. An existing loading load stays loading; a fresh track
            // change (manual or auto-next) enters loading.
            if (p.loading) {
              return {
                ...p,
                currentTrack: track,
                loadingTrack: track,
                playing: false,
                position: 0,
                duration: 0,
                history: newHistory,
              };
            }
            return {
              ...p,
              currentTrack: track,
              loading: true,
              loadingTrack: track,
              playing: false,
              position: 0,
              duration: 0,
              history: newHistory,
            };
          });
          break;
        }
        case 'queue-changed':
        case 'queue-refilled':
          if (Array.isArray(e.queue)) {
            set(p => ({ ...p, queue: e.queue as QueueItem[] }));
          }
          break;
        case 'volume-changed':
          set(p => ({
            ...p,
            volume: (e.volume as number) ?? p.volume,
            muted: (e.muted as boolean) ?? p.muted,
          }));
          break;
        case 'shuffle-changed':
          set(p => ({ ...p, shuffle: (e.enabled as boolean) ?? p.shuffle }));
          break;
        case 'repeat-changed':
          set(p => ({ ...p, repeat: (e.mode as RepeatMode) ?? p.repeat }));
          break;
        case 'favorites-changed':
          if (Array.isArray(e.favorites)) {
            set(p => ({ ...p, favorites: e.favorites as Track[] }));
          }
          break;
        case 'playlists-changed':
          if (Array.isArray(e.playlists)) {
            set(p => ({ ...p, playlists: e.playlists as Playlist[] }));
          }
          break;
        case 'history-changed':
          if (Array.isArray(e.history)) {
            set(p => ({ ...p, history: e.history as Track[] }));
          }
          break;
        case 'settings-changed':
          if (e.settings && typeof e.settings === 'object') {
            set(p => ({ ...p, settings: { ...DEFAULT_SETTINGS, ...(e.settings as AppSettings) } }));
          }
          break;
      }
    });
    return unsub;
  }, []);

  // ─── Commands ────────────────────────────────────────────────────────

  const send = useCallback(async (cmd: ControlCommand) => {
    console.log('[DEBUG-CMD] useBackend.send() cmd:', JSON.stringify(cmd));
    try {
      const r = await window.api.sendCommand(cmd);
      console.log('[DEBUG-CMD] useBackend.send() result:', JSON.stringify({ ok: r.ok, message: r.message, hasData: !!r.data }));
      if (!r.ok) {
        console.log('[DEBUG-CMD] useBackend.send() ERROR:', r.message);
        set(p => ({ ...p, error: r.message }));
        setTimeout(() => set(p => ({ ...p, error: null })), 4000);
      }
      return r;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log('[DEBUG-CMD] useBackend.send() EXCEPTION:', msg);
      set(p => ({ ...p, error: msg }));
      setTimeout(() => set(p => ({ ...p, error: null })), 4000);
      return { ok: false, message: msg };
    }
  }, []);

  const fetchState = useCallback(async () => {
    const r = await send({ type: 'get-state' });      if (r.ok && r.data) {
      const d = r.data as Record<string, unknown>;
      set(p => ({
        ...p,
        currentTrack: (d.currentTrack as Track) ?? null,
        queue: (d.queue as QueueItem[]) ?? [],
        history: (d.history as Track[]) ?? p.history,
        favorites: Array.isArray(d.favorites) ? (d.favorites as Track[]) : p.favorites,
        volume: (d.volume as number) ?? 100,
        muted: (d.muted as boolean) ?? false,
        playing: !(d.paused as boolean),
        position: (d.timePos as number) ?? 0,
        duration: (d.duration as number) ?? 0,
        shuffle: (d.shuffle as boolean) ?? false,
        repeat: (d.repeat as RepeatMode) ?? 'off',
        playlists: Array.isArray(d.playlists) ? (d.playlists as Playlist[]) : p.playlists,
        downloads: Array.isArray(d.downloads) ? (d.downloads as Track[]) : p.downloads,
        settings: d.settings && typeof d.settings === 'object'
          ? { ...DEFAULT_SETTINGS, ...(d.settings as AppSettings) }
          : p.settings,
      }));
    }
  }, [send]);

  const fetchQueue = useCallback(async () => {
    const r = await send({ type: 'get-queue' });
    if (r.ok && r.data) {
      set(p => ({ ...p, queue: r.data as QueueItem[] }));
    }
  }, [send]);

  // ─── Search ──────────────────────────────────────────────────────────

  const search = useCallback(async (query: string) => {
    if (!query.trim()) return;
    set(p => ({ ...p, searching: true, error: null }));
    try {
      const r = await send({ type: 'search', query, limit: 20 });
      set(p => ({
        ...p,
        searchResults: (r.ok && r.data) ? (r.data as Track[]) : [],
        searching: false,
        error: r.ok ? null : (r.message || 'Search failed'),
      }));
    } catch (err) {
      set(p => ({
        ...p,
        searchResults: [],
        searching: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [send]);

  // ─── Playback ────────────────────────────────────────────────────────

  const play = useCallback(async (track: Track) => {
    set(p => ({
      ...p,
      loading: true,
      loadingTrack: track,
      currentTrack: track,
      playing: false,
      position: 0,
      duration: track.duration ?? 0,
    }));
    // Safety timeout: clear loading if events never arrive
    const loadTimeout = setTimeout(() => {
      set(p => {
        if (p.loading && p.loadingTrack?.id === track.id) {
          return { ...p, loading: false, loadingTrack: null };
        }
        return p;
      });
    }, 30_000);
    const playCmd = { type: 'play-track' as const, track };
    console.log('[DEBUG-CMD] useBackend.play() sending command:', JSON.stringify(playCmd));
    const r = await send(playCmd);
    console.log('[DEBUG-CMD] useBackend.play() response:', JSON.stringify(r));
    clearTimeout(loadTimeout);
    // Clear loading if command failed (event-based clearing is primary)
    if (!r.ok) {
      set(p => ({ ...p, loading: false, loadingTrack: null }));
    }
  }, [send]);

  const addToQueue = useCallback(async (track: Track) => {
    await send({ type: 'add-to-queue', track });
    fetchQueue();
  }, [send, fetchQueue]);

  const playNext = useCallback(async (track: Track) => {
    await send({ type: 'play-next', track });
    fetchQueue();
  }, [send, fetchQueue]);

  const togglePause = useCallback(async () => {
    // Optimistic
    set(p => ({ ...p, playing: !p.playing }));
    const r = await send({ type: 'toggle' });
    if (!r.ok) set(p => ({ ...p, playing: !p.playing })); // revert
  }, [send]);

  const nextTrack = useCallback(async () => {
    set(p => ({
      ...p,
      loading: true,
      loadingTrack: p.queue[0]?.track ?? p.currentTrack,
      currentTrack: p.queue[0]?.track ?? p.currentTrack,
      playing: false,
      position: 0,
    }));
    const r = await send({ type: 'next' });
    if (!r.ok) set(p => ({ ...p, loading: false, loadingTrack: null }));
  }, [send]);

  const previousTrack = useCallback(async () => {
    set(p => ({
      ...p,
      loading: true,
      loadingTrack: p.currentTrack,
      playing: false,
      position: 0,
    }));
    const r = await send({ type: 'previous' });
    if (!r.ok) set(p => ({ ...p, loading: false, loadingTrack: null }));
  }, [send]);

  const seek = useCallback(async (seconds: number) => {
    // Optimistic
    set(p => ({ ...p, position: Math.max(0, Math.min(p.duration, p.position + seconds)) }));
    await send({ type: 'seek', seconds });
  }, [send]);

  const seekTo = useCallback(async (absolutePosition: number) => {
    const current = sRef.current.position;
    const diff = absolutePosition - current;
    set(p => ({ ...p, position: absolutePosition }));
    await send({ type: 'seek', seconds: diff });
  }, [send]);

  const setVolume = useCallback(async (vol: number) => {
    set(p => ({ ...p, volume: vol }));
    await send({ type: 'volume', value: vol, relative: false });
  }, [send]);

  const toggleMute = useCallback(async () => {
    set(p => ({ ...p, muted: !p.muted }));
    await send({ type: 'mute' });
  }, [send]);

  const toggleShuffle = useCallback(async () => {
    set(p => ({ ...p, shuffle: !p.shuffle }));
    await send({ type: 'shuffle', enabled: null });
  }, [send]);

  const cycleRepeat = useCallback(async () => {
    const modes: RepeatMode[] = ['off', 'one', 'all'];
    const next = modes[(modes.indexOf(sRef.current.repeat) + 1) % 3]!;
    set(p => ({ ...p, repeat: next }));
    await send({ type: 'repeat', mode: next });
  }, [send]);

  const toggleFavorite = useCallback(async (track?: Track) => {
    // If no track is supplied the backend toggles the currently playing track.
    // No optimistic update — the backend's favorites-changed event will
    // authoritatively update the list.
    await send({ type: 'favorite', ...(track ? { track } : {}) });
  }, [send]);

  const removeFromQueue = useCallback(async (index: number) => {
    await send({ type: 'remove-from-queue', index });
    fetchQueue();
  }, [send, fetchQueue]);

  const clearQueue = useCallback(async () => {
    await send({ type: 'queue', clear: true });
    fetchQueue();
  }, [send, fetchQueue]);

  const moveQueue = useCallback(async (from: number, to: number) => {
    await send({ type: 'move-queue', from, to });
    fetchQueue();
  }, [send, fetchQueue]);

  const playFromQueue = useCallback(async (index: number) => {
    const track = sRef.current.queue[index]?.track;
    if (track) {
      set(p => ({
        ...p,
        loading: true,
        loadingTrack: track,
        currentTrack: track,
        playing: false,
        position: 0,
      }));
    }
    const r = await send({ type: 'play-from-queue', index });
    if (!r.ok) set(p => ({ ...p, loading: false, loadingTrack: null }));
  }, [send]);

  const fetchLyrics = useCallback(async (track?: Track) => {
    const target = track ?? sRef.current.currentTrack;
    if (!target) {
      set(p => ({ ...p, lyrics: null, lyricsLoading: false }));
      return;
    }
    set(p => ({ ...p, lyricsLoading: true }));
    const r = await send({ type: 'get-lyrics', track: target });
    const data = r.ok ? (r.data as LyricsResult) : { trackId: target.id, lines: [] };
    set(p => {
      if (p.currentTrack?.id !== target.id) return p;
      return { ...p, lyricsLoading: false, lyrics: data };
    });
  }, [send]);

  const createPlaylist = useCallback(async (name: string) => {
    const r = await send({ type: 'create-playlist', name });
    return r.ok ? (r.data as Playlist) : null;
  }, [send]);

  const deletePlaylist = useCallback(async (id: string) => {
    await send({ type: 'delete-playlist', id });
  }, [send]);

  const renamePlaylist = useCallback(async (id: string, name: string) => {
    await send({ type: 'rename-playlist', id, name });
  }, [send]);

  const addToPlaylist = useCallback(async (id: string, track: Track) => {
    await send({ type: 'add-to-playlist', id, track });
  }, [send]);

  const removeFromPlaylist = useCallback(async (id: string, index: number) => {
    await send({ type: 'remove-from-playlist', id, index });
  }, [send]);

  const reorderPlaylist = useCallback(async (id: string, from: number, to: number) => {
    await send({ type: 'reorder-playlist', id, from, to });
  }, [send]);

  const playPlaylist = useCallback(async (id: string, index = 0) => {
    await send({ type: 'play-playlist', id, index });
  }, [send]);

  const saveQueueAsPlaylist = useCallback(async (name: string) => {
    await send({ type: 'save-queue-as-playlist', name });
  }, [send]);

  const clearHistory = useCallback(async () => {
    await send({ type: 'clear-history' });
  }, [send]);

  const saveSettings = useCallback(async (settings: Partial<AppSettings>) => {
    set(p => ({ ...p, settings: { ...p.settings, ...settings } }));
    await send({ type: 'save-settings', settings });
  }, [send]);

  const adjustVolume = useCallback(async (delta: number) => {
    set(p => ({ ...p, volume: Math.max(0, Math.min(100, p.volume + delta)) }));
    await send({ type: 'volume', value: delta, relative: true });
  }, [send]);

  const retryBackend = useCallback(async () => {
    set(p => ({ ...p, connectionState: 'starting' as ConnectionState }));
    await window.api.retryBackend();
  }, []);

  return {
    state: s,
    search, play, addToQueue, playNext,
    togglePause, nextTrack, previousTrack,
    seek, seekTo, setVolume, toggleMute,
    toggleShuffle, cycleRepeat, toggleFavorite,
    removeFromQueue, clearQueue, moveQueue, playFromQueue,
    fetchLyrics, createPlaylist, deletePlaylist, renamePlaylist,
    addToPlaylist, removeFromPlaylist, reorderPlaylist, playPlaylist,
    saveQueueAsPlaylist, clearHistory, saveSettings, adjustVolume,
    retryBackend,
  };
}
