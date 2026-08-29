import { EventEmitter } from 'events';
import { join } from 'path';
import { statSync } from 'fs';
import { Player } from './player';
import { search, fetchMix } from './search';
import {
  loadFavorites, saveFavorites, isFavorite, toggleFavorite,
  loadPlaylists, createPlaylist, deletePlaylist, renamePlaylist,
  addTrackToPlaylist, removeTrackFromPlaylist,
  loadDownloads, isDownloaded, addDownloadRecord, deleteDownloadRecord, MUSIC_DIR,
  loadSettings, saveSettings,
} from './config';
import type { Track, QueueItem, RepeatMode, Playlist } from './types';
import type { Settings } from './config';
import type { PlayerState } from './player';

// ─── Engine Events ────────────────────────────────────────────────────────

export type EngineEvent =
  | { type: 'track-changed'; track: Track | null }
  | { type: 'playback-state-changed'; paused: boolean; timePos: number; duration: number }
  | { type: 'playback-state'; track: Track | null; playing: boolean; position: number; duration: number; volume: number; muted: boolean; shuffle: boolean; repeat: RepeatMode }
  | { type: 'queue-changed'; queue: QueueItem[]; manualCount: number; radioCount: number }
  | { type: 'queue-refilled'; queue: QueueItem[]; manualCount: number; radioCount: number }
  | { type: 'volume-changed'; volume: number; muted: boolean }
  | { type: 'shuffle-changed'; enabled: boolean }
  | { type: 'repeat-changed'; mode: RepeatMode }
  | { type: 'favorites-changed'; favorites: Track[] }
  | { type: 'download-started'; trackId: string }
  | { type: 'download-completed'; track: Track }
  | { type: 'download-removed'; trackId: string };

// ─── PlaybackEngine ───────────────────────────────────────────────────────

const REFILL_THRESHOLD = 5;

export type SearchFn = (query: string, limit?: number) => Promise<Track[]>;
export type FetchMixFn = (videoId: string, limit?: number) => Promise<Track[]>;

export interface EngineDeps {
  player?: Player;
  searchFn?: SearchFn;
  fetchMixFn?: FetchMixFn;
  favorites?: Track[];
  playlists?: Playlist[];
  downloads?: Track[];
}

export class PlaybackEngine extends EventEmitter {
  private _currentTrack: Track | null = null;
  private _queue: QueueItem[] = [];
  private _history: Track[] = [];
  private _shuffleMode = false;
  private _mixGeneration = 0;
  private _fetchingMix = false;
  private _favorites: Track[] = [];
  private _playlists: Playlist[] = [];
  private _downloads: Track[] = [];
  private _downloadingTracks = new Set<string>();
  private _broadcastTimer: ReturnType<typeof setInterval> | null = null;

  readonly player: Player;
  private _searchFn: SearchFn;
  private _fetchMixFn: FetchMixFn;

  constructor(deps?: EngineDeps | Player) {
    super();
    // Backward-compatible: accept a plain Player or a full deps object
    if (deps && 'loadTrack' in deps) {
      this.player = deps;
      this._searchFn = search;
      this._fetchMixFn = fetchMix;
      this._favorites = loadFavorites();
      this._playlists = loadPlaylists();
      this._downloads = loadDownloads();
    } else {
      const d = deps as EngineDeps | undefined;
      this.player = d?.player ?? new Player();
      this._searchFn = d?.searchFn ?? search;
      this._fetchMixFn = d?.fetchMixFn ?? fetchMix;
      this._favorites = d?.favorites ?? loadFavorites();
      this._playlists = d?.playlists ?? loadPlaylists();
      this._downloads = d?.downloads ?? loadDownloads();
    }
    this._setupPlayerEvents();
  }

  // ─── Properties ────────────────────────────────────────────────────────

  get currentTrack(): Track | null { return this._currentTrack; }
  get queue(): QueueItem[] { return this._queue; }
  get history(): Track[] { return this._history; }
  get shuffleMode(): boolean { return this._shuffleMode; }
  get fetchingMix(): boolean { return this._fetchingMix; }
  get favorites(): Track[] { return this._favorites; }
  get playlists(): Playlist[] { return this._playlists; }
  get downloads(): Track[] { return this._downloads; }
  get downloadingTracks(): Set<string> { return this._downloadingTracks; }

  get state(): PlayerState { return this.player.state; }

  get volume(): number { return this.player.state.volume; }

  // ─── Queue Helpers ─────────────────────────────────────────────────────

  private manualCount(): number {
    return this._queue.filter(qi => qi.source === 'manual').length;
  }

  private radioCount(): number {
    return this._queue.filter(qi => qi.source === 'radio').length;
  }

  private emitQueueChanged(): void {
    this.emit('queue-changed', {
      type: 'queue-changed' as const,
      queue: this._queue,
      manualCount: this.manualCount(),
      radioCount: this.radioCount(),
    } satisfies EngineEvent);
  }

  private emitQueueRefilled(): void {
    this.emit('queue-refilled', {
      type: 'queue-refilled' as const,
      queue: this._queue,
      manualCount: this.manualCount(),
      radioCount: this.radioCount(),
    } satisfies EngineEvent);
  }

  private shuffleArray(arr: Track[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
  }

  // ─── Player Events ─────────────────────────────────────────────────────

  private _setupPlayerEvents(): void {
    this.player.on('end-file', (event: { reason: string }) => {
      this._onEndOfFile(event);
    });

    this.player.on('state', () => {
      this.emit('volume-changed', {
        type: 'volume-changed',
        volume: this.player.state.volume,
        muted: this.player.state.muted,
      } satisfies EngineEvent);
    });
  }

  /**
   * Start broadcasting playback position/state at ~500ms intervals.
   * This is what the GUI uses for the progress bar and play/pause state.
   */
  private _startPlaybackBroadcast(): void {
    this._stopPlaybackBroadcast();
    this._broadcastTimer = setInterval(() => {
      this._emitPlaybackState();
    }, 500);
  }

  private _stopPlaybackBroadcast(): void {
    if (this._broadcastTimer) {
      clearInterval(this._broadcastTimer);
      this._broadcastTimer = null;
    }
  }

  private _emitPlaybackState(): void {
    this.emit('playback-state', {
      type: 'playback-state' as const,
      track: this._currentTrack,
      playing: !this.player.state.paused,
      position: this.player.state.timePos,
      duration: this.player.state.duration,
      volume: this.player.state.volume,
      muted: this.player.state.muted,
      shuffle: this._shuffleMode,
      repeat: this.player.state.repeatMode,
    } satisfies EngineEvent);
  }

  private async _onEndOfFile(event: { reason: string }): Promise<void> {
    if (event.reason !== 'eof' || !this._currentTrack) return;

    const repeatMode = this.player.state.repeatMode;

    // repeat-one: mpv loops the file, end-file won't fire for eof
    if (repeatMode === 'one') return;

    if (this._queue.length > 0) {
      this._history.push(this._currentTrack);
      const next = this._queue.shift()!;
      this._currentTrack = next.track;
      await this.player.loadTrack(next.track.url);

      this.emit('track-changed', { type: 'track-changed', track: this._currentTrack });
      this.emitQueueChanged();

      // Refill radio when it gets low and no manual tracks remain
      if (this.manualCount() === 0 && this.radioCount() < REFILL_THRESHOLD) {
        this._refillQueue(next.track.id);
      }
    } else if (repeatMode === 'all' && this._history.length > 0) {
      // repeat-all: re-queue everything from history
      this._queue = this._history.map(t => ({ track: t, source: 'radio' as const }));
      this._history = [];
      if (this._shuffleMode) this._shuffleOnlyRadio();
      // play the first re-queued track
      const next = this._queue.shift()!;
      this._currentTrack = next.track;
      await this.player.loadTrack(next.track.url);
      this.emit('track-changed', { type: 'track-changed', track: this._currentTrack });
      this.emitQueueChanged();
    }
    // else: queue empty and no repeat → playback ends
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  async start(): Promise<void> {
    await this.player.start();
  }

  async quit(): Promise<void> {
    this._stopPlaybackBroadcast();
    await this.player.quit();
  }

  // ─── Core Playback ─────────────────────────────────────────────────────

  /**
   * Play a track immediately. Clears the queue (both manual and radio),
   * generates a fresh radio mix, and starts playback.
   */
  async play(track: Track): Promise<void> {
    const generation = ++this._mixGeneration;

    if (this._currentTrack) {
      this._history.push(this._currentTrack);
    }
    this._queue = [];
    this._currentTrack = track;

    // Check if downloaded locally
    let playUrl = track.url;
    if (isDownloaded(this._downloads, track.id)) {
      const localPath = join(MUSIC_DIR, `${track.id}.mp3`);
      try {
        if (statSync(localPath).isFile()) {
          playUrl = localPath;
        }
      } catch {}
    }

    await this.player.loadTrack(playUrl);
    this._startPlaybackBroadcast();
    this.emit('track-changed', { type: 'track-changed', track: this._currentTrack });

    // Generate radio mix in background
    this._fetchingMix = true;
    this._fetchMixFn(track.id, 25)
      .then(mixTracks => {
        if (generation !== this._mixGeneration) return;
        this._queue = mixTracks
          .filter(t => t.id !== track.id)
          .slice(0, 22)
          .map(t => ({ track: t, source: 'radio' as const }));
        if (this._shuffleMode) this._shuffleOnlyRadio();
        this.emitQueueRefilled();
      })
      .catch(() => {})
      .finally(() => {
        if (generation === this._mixGeneration) this._fetchingMix = false;
      });
  }

  /**
   * Play a track from a playlist. Seeds the queue with remaining playlist tracks,
   * then radio will continue after they're exhausted.
   */
  async playPlaylistTrack(track: Track, remainingTracks: Track[]): Promise<void> {
    const generation = ++this._mixGeneration;

    if (this._currentTrack) {
      this._history.push(this._currentTrack);
    }
    this._queue = remainingTracks.map(t => ({ track: t, source: 'playlist' as const }));
    if (this._shuffleMode) {
      // Shuffle playlist tracks but keep the seed track's context
      const shuffled = [...remainingTracks];
      this.shuffleArray(shuffled);
      this._queue = shuffled.map(t => ({ track: t, source: 'playlist' as const }));
    }
    this._currentTrack = track;

    let playUrl = track.url;
    if (isDownloaded(this._downloads, track.id)) {
      const localPath = join(MUSIC_DIR, `${track.id}.mp3`);
      try {
        if (statSync(localPath).isFile()) {
          playUrl = localPath;
        }
      } catch {}
    }

    await this.player.loadTrack(playUrl);
    this._startPlaybackBroadcast();
    this._fetchingMix = false;
    this.emit('track-changed', { type: 'track-changed', track: this._currentTrack });
    this.emitQueueChanged();
  }

  /**
   * Add a track to the end of the queue (manual).
   * Does NOT trigger radio generation or refill.
   */
  addToQueue(track: Track): void {
    this._queue.push({ track, source: 'manual' });
    this.emitQueueChanged();
  }

  /**
   * Insert a track immediately after the current track (manual).
   * Does NOT trigger radio generation or refill.
   */
  playNext(track: Track): void {
    this._queue.unshift({ track, source: 'manual' });
    this.emitQueueChanged();
  }

  /**
   * Advance to the next track in the queue.
   * Manual tracks are consumed first, then radio tracks.
   */
  async playNextTrack(): Promise<boolean> {
    if (this._queue.length === 0) return false;

    if (this._currentTrack) {
      this._history.push(this._currentTrack);
    }
    const next = this._queue.shift()!;
    this._currentTrack = next.track;
    await this.player.loadTrack(next.track.url);

    this.emit('track-changed', { type: 'track-changed', track: this._currentTrack });
    this.emitQueueChanged();

    // Refill radio when it gets low and no manual tracks remain
    if (this.manualCount() === 0 && this.radioCount() < REFILL_THRESHOLD) {
      this._refillQueue(next.track.id);
    }
    return true;
  }

  /**
   * Go back to the previously played track.
   */
  async playPreviousTrack(): Promise<boolean> {
    if (this._history.length === 0) return false;

    if (this._currentTrack) {
      this._queue.unshift({ track: this._currentTrack, source: 'manual' });
    }
    const previous = this._history.pop()!;
    this._currentTrack = previous;
    await this.player.loadTrack(previous.url);

    this.emit('track-changed', { type: 'track-changed', track: this._currentTrack });
    this.emitQueueChanged();
    return true;
  }

  /**
   * Remove a track from the queue by index.
   */
  removeFromQueue(index: number): void {
    if (index < 0 || index >= this._queue.length) return;
    this._queue.splice(index, 1);
    this.emitQueueChanged();

    // If queue got low on radio, refill
    if (this.manualCount() === 0 && this.radioCount() < REFILL_THRESHOLD && this._currentTrack) {
      this._refillQueue(this._currentTrack.id);
    }
  }

  /**
   * Clear the entire queue (both manual and radio).
   */
  clearQueue(): void {
    ++this._mixGeneration;
    this._fetchingMix = false;
    this._queue = [];
    this.emitQueueChanged();
  }

  /**
   * Search for tracks (delegates to yt-dlp search).
   */
  async searchTracks(query: string, limit?: number): Promise<Track[]> {
    return this._searchFn(query, limit);
  }

  // ─── Shuffle ───────────────────────────────────────────────────────────

  setShuffle(enabled: boolean): void {
    const changed = this._shuffleMode !== enabled;
    this._shuffleMode = enabled;
    if (changed && enabled && this._queue.length > 0) {
      this._shuffleOnlyRadio();
      this.emitQueueChanged();
    }
    this.emit('shuffle-changed', { type: 'shuffle-changed', enabled } satisfies EngineEvent);
  }

  /**
   * Shuffle only radio tracks, keeping manual tracks in their original order
   * at the front of the queue.
   */
  private _shuffleOnlyRadio(): void {
    const manual: QueueItem[] = [];
    const radio: QueueItem[] = [];

    for (const qi of this._queue) {
      if (qi.source === 'manual') {
        manual.push(qi);
      } else {
        radio.push(qi);
      }
    }

    // Shuffle the radio portion
    for (let i = radio.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = radio[i]!;
      radio[i] = radio[j]!;
      radio[j] = tmp;
    }

    this._queue = [...manual, ...radio];
  }

  // ─── Repeat ────────────────────────────────────────────────────────────

  async setRepeatMode(mode: RepeatMode): Promise<void> {
    await this.player.setRepeatMode(mode);
    this.emit('repeat-changed', { type: 'repeat-changed', mode } satisfies EngineEvent);
  }

  // ─── Volume ────────────────────────────────────────────────────────────

  async setVolume(level: number): Promise<number> {
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    await this.player.setVolume(clamped);
    this.emit('volume-changed', {
      type: 'volume-changed',
      volume: clamped,
      muted: this.player.state.muted,
    } satisfies EngineEvent);
    return clamped;
  }

  async getVolume(): Promise<number> {
    return this.player.getVolume();
  }

  async toggleMute(): Promise<boolean> {
    await this.player.toggleMute();
    this.emit('volume-changed', {
      type: 'volume-changed',
      volume: this.player.state.volume,
      muted: this.player.state.muted,
    } satisfies EngineEvent);
    return this.player.state.muted;
  }

  // ─── Pause/Resume ──────────────────────────────────────────────────────

  async togglePause(): Promise<void> {
    await this.player.togglePause();
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.player.setPaused(paused);
  }

  async seek(seconds: number): Promise<void> {
    await this.player.seek(seconds);
  }

  async stop(): Promise<void> {
    ++this._mixGeneration;
    this._fetchingMix = false;
    this._stopPlaybackBroadcast();
    this._queue = [];
    this._history = [];
    this._currentTrack = null;
    await this.player.stop();
    this._emitPlaybackState();
  }

  // ─── Favorites ─────────────────────────────────────────────────────────

  isFavorite(id: string): boolean {
    return isFavorite(this._favorites, id);
  }

  toggleFavorite(track: Track): boolean {
    const result = toggleFavorite(this._favorites, track);
    this._favorites = result.favorites;
    this.emit('favorites-changed', {
      type: 'favorites-changed',
      favorites: this._favorites,
    } satisfies EngineEvent);
    return result.added;
  }

  // ─── Playlists ─────────────────────────────────────────────────────────

  createPlaylist(name: string): Playlist {
    const playlist = createPlaylist(this._playlists, name);
    this._playlists = [...this._playlists];
    return playlist;
  }

  deletePlaylistById(id: string): void {
    this._playlists = deletePlaylist(this._playlists, id);
  }

  renamePlaylistById(id: string, newName: string): void {
    renamePlaylist(this._playlists, id, newName);
  }

  addTrackToPlaylist(playlistId: string, track: Track): boolean {
    return addTrackToPlaylist(this._playlists, playlistId, track);
  }

  removeTrackFromPlaylist(playlistId: string, trackIdx: number): void {
    removeTrackFromPlaylist(this._playlists, playlistId, trackIdx);
  }

  // ─── Downloads ─────────────────────────────────────────────────────────

  isDownloaded(id: string): boolean {
    return isDownloaded(this._downloads, id);
  }

  isDownloading(id: string): boolean {
    return this._downloadingTracks.has(id);
  }

  toggleDownload(track: Track): void {
    if (this.isDownloaded(track.id)) {
      this._downloads = deleteDownloadRecord(this._downloads, track.id);
      try {
        const { unlinkSync } = require('fs');
        unlinkSync(join(MUSIC_DIR, `${track.id}.mp3`));
      } catch {}
      this.emit('download-removed', { type: 'download-removed', trackId: track.id } satisfies EngineEvent);
    } else if (!this._downloadingTracks.has(track.id)) {
      this._downloadingTracks.add(track.id);
      this.emit('download-started', { type: 'download-started', trackId: track.id } satisfies EngineEvent);

      const { resolveCommand } = require('./platform');
      const { getYtdlpPrivacyArgs } = require('./privacy');
      const ytdlp = resolveCommand('yt-dlp') ?? 'yt-dlp';
      const proc = Bun.spawn([ytdlp, ...getYtdlpPrivacyArgs(), '-x', '--audio-format', 'mp3', '-o', join(MUSIC_DIR, `${track.id}.mp3`), track.url], {
        stdout: 'ignore',
        stderr: 'ignore',
        onExit: (_p: any, exitCode: number) => {
          this._downloadingTracks.delete(track.id);
          if (exitCode === 0) {
            this._downloads = addDownloadRecord(this._downloads, track);
            this.emit('download-completed', { type: 'download-completed', track } satisfies EngineEvent);
          } else {
            this.emit('download-removed', { type: 'download-removed', trackId: track.id } satisfies EngineEvent);
          }
        },
      });
    }
  }

  // ─── Settings ──────────────────────────────────────────────────────────

  loadSettings(): Settings {
    return loadSettings();
  }

  saveSettings(settings: Settings): void {
    saveSettings(settings);
  }

  // ─── Queue Refill (Radio) ──────────────────────────────────────────────

  private _refillQueue(fromId: string): void {
    const generation = this._mixGeneration;
    this._fetchingMix = true;
    const existingIds = new Set(this._queue.map(qi => qi.track.id));

    this._fetchMixFn(fromId, 20)
      .then(tracks => {
        if (generation !== this._mixGeneration) return;
        const newTracks = tracks
          .filter(t => t.id !== fromId && !existingIds.has(t.id))
          .map(t => ({ track: t, source: 'radio' as const }));
        if (this._shuffleMode) {
          this.shuffleArray(newTracks.map(qi => qi.track));
        }
        this._queue.push(...newTracks);
        this.emitQueueRefilled();
      })
      .catch(() => {})
      .finally(() => {
        if (generation === this._mixGeneration) this._fetchingMix = false;
      });
  }
}
