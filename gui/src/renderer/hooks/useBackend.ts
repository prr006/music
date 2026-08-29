import { useState, useEffect, useCallback, useRef } from 'react';
import type { Track, QueueItem, RepeatMode, ControlCommand, ControlResponse } from '../../shared/types';

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
  searchResults: Track[];
  searching: boolean;
  error: string | null;
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
    searchResults: [],
    searching: false,
    error: null,
  });

  const sRef = useRef(s);
  sRef.current = s;

  // ─── Connection ──────────────────────────────────────────────────────

  useEffect(() => {
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
          // The authoritative real-time state from the backend.
          // track-changed handles loading→playing transition.
          // playback-state only updates position/duration/volume/flags.
          const track = e.track as Track | null;
          const playing = e.playing as boolean;
          set(p => {
            // If we were loading and the backend now reports a DIFFERENT track,
            // the play request was superseded — clear loading
            if (p.loading && p.loadingTrack && track && track.id !== p.loadingTrack.id) {
              return {
                ...p,
                currentTrack: track,
                playing,
                position: (e.position as number) ?? 0,
                duration: (e.duration as number) ?? 0,
                volume: (e.volume as number) ?? p.volume,
                muted: (e.muted as boolean) ?? p.muted,
                shuffle: (e.shuffle as boolean) ?? p.shuffle,
                repeat: (e.repeat as RepeatMode) ?? p.repeat,
                loading: false,
                loadingTrack: null,
              };
            }
            // Normal update: just sync position/duration/volume/flags
            return {
              ...p,
              currentTrack: track,
              playing,
              position: (e.position as number) ?? 0,
              duration: (e.duration as number) ?? 0,
              volume: (e.volume as number) ?? p.volume,
              muted: (e.muted as boolean) ?? p.muted,
              shuffle: (e.shuffle as boolean) ?? p.shuffle,
              repeat: (e.repeat as RepeatMode) ?? p.repeat,
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
            return {
              ...p,
              currentTrack: track,
              playing: !!track,
              loading: false,
              loadingTrack: null,
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
        volume: (d.volume as number) ?? 100,
        muted: (d.muted as boolean) ?? false,
        playing: !(d.paused as boolean),
        position: (d.timePos as number) ?? 0,
        duration: (d.duration as number) ?? 0,
        shuffle: (d.shuffle as boolean) ?? false,
        repeat: (d.repeat as RepeatMode) ?? 'off',
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
      const r = await send({ type: 'search', query, limit: 8 });
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
    // Optimistic: show loading immediately
    set(p => ({
      ...p,
      loading: true,
      loadingTrack: track,
      currentTrack: track,
      playing: true,
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
    await send({ type: 'next' });
  }, [send]);

  const previousTrack = useCallback(async () => {
    await send({ type: 'previous' });
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

  const removeFromQueue = useCallback(async (index: number) => {
    await send({ type: 'remove-from-queue', index });
    fetchQueue();
  }, [send, fetchQueue]);

  const clearQueue = useCallback(async () => {
    await send({ type: 'queue', clear: true });
    fetchQueue();
  }, [send, fetchQueue]);

  const retryBackend = useCallback(async () => {
    set(p => ({ ...p, connectionState: 'starting' as ConnectionState }));
    await window.api.retryBackend();
  }, []);

  return {
    state: s,
    search, play, addToQueue, playNext,
    togglePause, nextTrack, previousTrack,
    seek, seekTo, setVolume, toggleMute,
    toggleShuffle, cycleRepeat,
    removeFromQueue, clearQueue,
    retryBackend,
  };
}
