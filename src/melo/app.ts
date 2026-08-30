import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { log, logError } from './log';
import { FavoritesService } from './favorites/favorites-service';
import { HistoryService } from './history/history-service';
import { LibraryService } from './library/library-service';
import { JsonStore } from './persistence/json-store';
import { migrateUserData } from './persistence/migrate';
import { MpvPlayer } from './playback/mpv-player';
import { QueueService } from './queue/queue-service';
import { YoutubeRadio } from './radio/youtube-radio';
import { YoutubeSearch } from './search/youtube-search';
import type {
  AppSettings,
  AppState,
  MeloEvent,
  PlaybackDriver,
  PlaybackSnapshot,
  RadioProvider,
  RepeatMode,
  SearchProvider,
  SourceResolver,
  Track,
} from './types';
import { YoutubeLyrics, type LyricsProvider } from './lyrics/youtube-lyrics';
import { YoutubeResolver } from './youtube/resolver';

const RADIO_REFILL_THRESHOLD = 5;
const BROADCAST_MS = 500;

export interface MeloDeps {
  playback?: PlaybackDriver;
  search?: SearchProvider;
  radio?: RadioProvider;
  resolver?: SourceResolver;
  store?: JsonStore;
  favorites?: FavoritesService;
  history?: HistoryService;
  library?: LibraryService;
  lyrics?: LyricsProvider;
}

export class MeloApp extends EventEmitter {
  readonly playback: PlaybackDriver;
  readonly queue = new QueueService();
  private readonly favoritesService: FavoritesService;
  private readonly historyService: HistoryService;
  readonly library: LibraryService;
  private readonly searchProvider: SearchProvider;
  private readonly radioProvider: RadioProvider;
  private readonly resolver: SourceResolver;
  private readonly lyricsProvider: LyricsProvider;

  private current: Track | null = null;
  private shuffle = false;
  private radioGeneration = 0;
  private playGeneration = 0;
  private switching = false;
  private fetchingRadio = false;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;
  private advancing = false;
  private lastVolume = 100;
  private lastMuted = false;

  constructor(deps: MeloDeps = {}) {
    super();
    if (!deps.store) migrateUserData();
    const store = deps.store ?? new JsonStore();
    this.playback = deps.playback ?? new MpvPlayer();
    this.searchProvider = deps.search ?? new YoutubeSearch();
    this.radioProvider = deps.radio ?? new YoutubeRadio();
    this.resolver = deps.resolver ?? new YoutubeResolver();
    this.favoritesService = deps.favorites ?? new FavoritesService(store);
    this.historyService = deps.history ?? new HistoryService(store);
    this.library = deps.library ?? new LibraryService(store);
    this.lyricsProvider = deps.lyrics ?? new YoutubeLyrics();
    this.lastVolume = this.playback.snapshot.volume;
    this.lastMuted = this.playback.snapshot.muted;
    this.on('error', () => {});
    this.playback.on('end-file', info => { void this.onEndFile(info); });
    this.playback.on('state', () => {
      const { volume, muted } = this.playback.snapshot;
      if (volume === this.lastVolume && muted === this.lastMuted) return;
      this.lastVolume = volume;
      this.lastMuted = muted;
      this.emitEvent({ type: 'volume-changed', volume, muted });
    });
  }

  get currentTrack(): Track | null { return this.current; }
  get shuffleMode(): boolean { return this.shuffle; }
  get fetchingMix(): boolean { return this.fetchingRadio; }
  get volume(): number { return this.playback.snapshot.volume; }
  get state(): PlaybackSnapshot { return this.playback.snapshot; }
  get playlists() { return this.library.playlists; }
  get downloads() { return this.library.downloads; }
  get downloadingTracks() { return this.library.downloading; }
  get favorites(): Track[] { return this.favoritesService.snapshot(); }
  get history(): Track[] { return this.historyService.snapshot(); }

  snapshot(): AppState {
    const p = this.playback.snapshot;
    return {
      currentTrack: this.current,
      queue: this.queue.snapshot(),
      history: this.historyService.snapshot(),
      favorites: this.favoritesService.snapshot(),
      volume: p.volume,
      muted: p.muted,
      paused: p.paused,
      timePos: p.timePos,
      duration: p.duration,
      shuffle: this.shuffle,
      repeat: p.repeatMode,
      playlists: this.library.playlists,
      downloads: this.library.downloads,
      settings: this.library.settings,
    };
  }

  async start(): Promise<void> {
    await this.playback.start();
    log('app', 'playback ready');
  }

  async quit(): Promise<void> {
    this.stopBroadcast();
    await this.playback.quit();
  }

  async searchTracks(query: string, limit?: number): Promise<Track[]> {
    if (!query.trim()) return [];
    try {
      return await this.searchProvider.search(query, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError('search', message);
      this.emitEvent({ type: 'error', message, area: 'search' });
      return [];
    }
  }

  async play(track: Track): Promise<void> {
    const radioGeneration = ++this.radioGeneration;
    const loaded = await this.beginTrack(track, { recordHistory: true, clearQueue: true });
    if (loaded) void this.seedRadio(track.id, radioGeneration);
  }

  async playPlaylistTrack(track: Track, remaining: Track[]): Promise<void> {
    ++this.radioGeneration;
    this.fetchingRadio = false;
    this.queue.replaceAll(remaining.map(item => ({ track: item, source: 'playlist' as const })));
    if (this.shuffle) this.queue.shuffleRadio();
    await this.beginTrack(track, { recordHistory: true, clearQueue: false });
  }

  addToQueue(track: Track): void {
    this.queue.add(track, 'manual');
    this.emitQueue('queue-changed');
  }

  playNext(track: Track): void {
    this.queue.insertFront(track, 'manual');
    this.emitQueue('queue-changed');
  }

  async playNextTrack(): Promise<boolean> {
    const next = this.queue.shift();
    if (!next) return false;
    const loaded = await this.beginTrack(next.track, { recordHistory: true, clearQueue: false });
    if (loaded) this.maybeRefill(next.track.id);
    return true;
  }

  async playPreviousTrack(): Promise<boolean> {
    const previous = this.historyService.pop();
    if (!previous) return false;
    if (this.current) this.queue.insertFront(this.current, 'manual');
    await this.beginTrack(previous, { recordHistory: false, clearQueue: false });
    return true;
  }

  removeFromQueue(index: number): void {
    this.queue.removeAt(index);
    this.emitQueue('queue-changed');
    if (this.current) this.maybeRefill(this.current.id);
  }

  moveQueue(from: number, to: number): boolean {
    const moved = this.queue.move(from, to);
    if (moved) this.emitQueue('queue-changed');
    return moved;
  }

  async playFromQueue(index: number): Promise<boolean> {
    if (index < 0 || index >= this.queue.length) return false;
    const target = this.queue.snapshot()[index];
    if (!target) return false;
    for (let i = 0; i <= index; i++) this.queue.shift();
    const loaded = await this.beginTrack(target.track, { recordHistory: true, clearQueue: false });
    if (loaded) this.maybeRefill(target.track.id);
    return true;
  }

  async lyricsFor(track: Track) {
    return this.lyricsProvider.lyricsFor(track);
  }

  clearHistory(): void {
    this.historyService.clear();
    this.emitEvent({ type: 'history-changed', history: this.historyService.snapshot() });
  }

  clearQueue(): void {
    ++this.radioGeneration;
    this.fetchingRadio = false;
    this.queue.clear();
    this.emitQueue('queue-changed');
  }

  setShuffle(enabled: boolean): void {
    const changed = this.shuffle !== enabled;
    this.shuffle = enabled;
    if (changed && enabled && this.queue.length > 0) {
      this.queue.shuffleRadio();
      this.emitQueue('queue-changed');
    }
    this.emitEvent({ type: 'shuffle-changed', enabled });
  }

  async setRepeatMode(mode: RepeatMode): Promise<void> {
    await this.playback.setRepeatMode(mode);
    this.emitEvent({ type: 'repeat-changed', mode });
  }

  async setVolume(level: number): Promise<number> {
    const volume = await this.playback.setVolume(level);
    this.lastVolume = volume;
    this.emitEvent({ type: 'volume-changed', volume, muted: this.playback.snapshot.muted });
    return volume;
  }

  async getVolume(): Promise<number> {
    return this.playback.getVolume();
  }

  async toggleMute(): Promise<boolean> {
    const muted = await this.playback.toggleMute();
    this.lastMuted = muted;
    this.emitEvent({ type: 'volume-changed', volume: this.playback.snapshot.volume, muted });
    return muted;
  }

  async togglePause(): Promise<void> {
    await this.playback.togglePause();
    this.emitPlayback();
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.playback.setPaused(paused);
    this.emitPlayback();
  }

  async seek(seconds: number): Promise<void> {
    await this.playback.seek(seconds);
  }

  async stop(): Promise<void> {
    this.playGeneration += 1;
    this.switching = false;
    ++this.radioGeneration;
    this.fetchingRadio = false;
    this.stopBroadcast();
    this.queue.clear();
    this.historyService.clearSession();
    this.current = null;
    try { await this.playback.stop(); } catch {}
    this.emitPlayback();
    this.emitEvent({ type: 'track-changed', track: null });
    this.emitQueue('queue-changed');
  }

  isFavorite(id: string): boolean {
    return this.favoritesService.has(id);
  }

  toggleFavorite(track: Track): boolean {
    const added = this.favoritesService.toggle(track);
    this.emitEvent({ type: 'favorites-changed', favorites: this.favoritesService.snapshot() });
    return added;
  }

  createPlaylist(name: string) {
    const playlist = this.library.createPlaylist(name);
    this.emitPlaylists();
    return playlist;
  }
  deletePlaylistById(id: string) {
    this.library.deletePlaylist(id);
    this.emitPlaylists();
  }
  renamePlaylistById(id: string, name: string) {
    this.library.renamePlaylist(id, name);
    this.emitPlaylists();
  }
  addTrackToPlaylist(id: string, track: Track) {
    const added = this.library.addToPlaylist(id, track);
    if (added) this.emitPlaylists();
    return added;
  }
  removeTrackFromPlaylist(id: string, index: number) {
    this.library.removeFromPlaylist(id, index);
    this.emitPlaylists();
  }
  reorderPlaylist(id: string, from: number, to: number) {
    const moved = this.library.reorderPlaylist(id, from, to);
    if (moved) this.emitPlaylists();
    return moved;
  }
  async playPlaylist(id: string, index = 0): Promise<boolean> {
    const playlist = this.library.playlistById(id);
    if (!playlist || playlist.tracks.length === 0) return false;
    const start = Math.max(0, Math.min(index, playlist.tracks.length - 1));
    const track = playlist.tracks[start];
    if (!track) return false;
    await this.playPlaylistTrack(track, playlist.tracks.slice(start + 1));
    return true;
  }
  saveQueueAsPlaylist(name: string) {
    const playlist = this.createPlaylist(name);
    if (this.current) this.library.addToPlaylist(playlist.id, this.current);
    for (const item of this.queue.snapshot()) this.library.addToPlaylist(playlist.id, item.track);
    this.emitPlaylists();
    return this.library.playlistById(playlist.id) ?? playlist;
  }
  isDownloaded(id: string) { return this.library.isDownloaded(id); }
  isDownloading(id: string) { return this.library.downloading.has(id); }
  loadSettings() { return this.library.settings; }
  saveSettings(settings: Partial<AppSettings>) {
    this.library.saveSettings(settings);
    this.emitEvent({ type: 'settings-changed', settings: this.library.settings });
  }

  toggleDownload(track: Track): void {
    this.library.toggleDownload(track, event => {
      if (event === 'started') this.emitEvent({ type: 'download-started', trackId: track.id });
      if (event === 'completed') this.emitEvent({ type: 'download-completed', track });
      if (event === 'removed') this.emitEvent({ type: 'download-removed', trackId: track.id });
    });
  }

  private async haltAudio(): Promise<void> {
    this.stopBroadcast();
    try {
      await this.playback.stop();
    } catch {
      /* idle player may reject stop */
    }
  }

  /**
   * Stop current audio immediately, then resolve/load the next URL.
   * A newer playGeneration makes in-flight resolves and loads no-ops.
   */
  private async beginTrack(
    track: Track,
    opts: { recordHistory: boolean; clearQueue: boolean },
  ): Promise<boolean> {
    const gen = ++this.playGeneration;
    this.switching = true;
    await this.haltAudio();
    if (opts.recordHistory && this.current) this.historyService.record(this.current);
    if (opts.clearQueue) this.queue.clear();
    this.current = track;
    this.emitPlayback();
    this.emitQueue('queue-changed');
    let loaded = false;
    try {
      loaded = await this.loadCurrent(gen);
    } catch (error) {
      if (gen === this.playGeneration) {
        this.switching = false;
        this.emitPlayback();
      }
      throw error;
    }
    if (gen !== this.playGeneration) return false;
    this.switching = false;
    if (!loaded) {
      this.emitPlayback();
      return false;
    }
    this.startBroadcast();
    this.emitEvent({ type: 'track-changed', track });
    return true;
  }

  private async loadCurrent(gen: number): Promise<boolean> {
    if (!this.current) return false;
    if (gen !== this.playGeneration) return false;
    const local = this.library.localPath(this.current.id);
    let url = this.current.url;

    if (this.library.isDownloaded(this.current.id) && existsSync(local)) {
      url = local;
    } else {
      try {
        url = await this.resolver.resolveAudioUrl(this.current);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError('playback', `resolver fallback to watch URL: ${message}`);
        this.emitEvent({ type: 'error', message, area: 'youtube' });
        url = this.current.url;
      }
    }

    if (gen !== this.playGeneration) return false;

    try {
      await this.playback.load(url);
    } catch (error) {
      if (gen !== this.playGeneration) return false;
      const message = error instanceof Error ? error.message : String(error);
      logError('playback', `load failed: ${message}`);
      this.emitEvent({ type: 'error', message, area: 'playback' });
      throw error;
    }

    if (gen !== this.playGeneration) {
      try { await this.playback.stop(); } catch { /* superseded */ }
      return false;
    }
    return true;
  }

  private async seedRadio(videoId: string, generation: number): Promise<void> {
    this.fetchingRadio = true;
    try {
      const related = await this.radioProvider.related(videoId, 25);
      if (generation !== this.radioGeneration) return;
      const tracks = related.filter(track => track.id !== videoId).slice(0, 22);
      this.queue.setRadio(tracks, this.shuffle);
      this.emitQueue('queue-refilled');
    } catch (error) {
      logError('radio', error instanceof Error ? error.message : String(error));
    } finally {
      if (generation === this.radioGeneration) this.fetchingRadio = false;
    }
  }

  private maybeRefill(fromId: string): void {
    if (this.queue.manualCount() > 0) return;
    if (this.queue.radioCount() >= RADIO_REFILL_THRESHOLD) return;
    const generation = this.radioGeneration;
    this.fetchingRadio = true;
    const exclude = this.queue.ids();
    exclude.add(fromId);
    this.radioProvider.related(fromId, 20)
      .then(tracks => {
        if (generation !== this.radioGeneration) return;
        const fresh = tracks.filter(track => !exclude.has(track.id));
        if (this.shuffle) {
          for (let i = fresh.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = fresh[i]!;
            fresh[i] = fresh[j]!;
            fresh[j] = tmp;
          }
        }
        this.queue.appendRadio(fresh);
        this.emitQueue('queue-refilled');
      })
      .catch(error => logError('radio', error instanceof Error ? error.message : String(error)))
      .finally(() => {
        if (generation === this.radioGeneration) this.fetchingRadio = false;
      });
  }

  private async onEndFile(event: { reason: string }): Promise<void> {
    if (event.reason !== 'eof' || !this.current || this.advancing) return;
    if (this.playback.snapshot.repeatMode === 'one') return;
    if (!this.library.settings.autoplay && this.playback.snapshot.repeatMode === 'off') return;

    this.advancing = true;
    try {
      if (this.queue.length > 0) {
        await this.playNextTrack();
        return;
      }
      if (this.playback.snapshot.repeatMode === 'all') {
        const history = this.historyService.snapshot();
        if (history.length === 0) return;
        this.queue.replaceAll(history.map(track => ({ track, source: 'radio' as const })));
        await this.playNextTrack();
      }
    } catch (error) {
      logError('playback', error instanceof Error ? error.message : String(error));
      try { await this.playNextTrack(); } catch {}
    } finally {
      this.advancing = false;
    }
  }

  private startBroadcast() {
    this.stopBroadcast();
    this.broadcastTimer = setInterval(() => this.emitPlayback(), BROADCAST_MS);
    this.emitPlayback();
  }

  private stopBroadcast() {
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
    }
  }

  private emitPlayback() {
    const p = this.playback.snapshot;
    this.emitEvent({
      type: 'playback-state',
      track: this.current,
      playing: !this.switching && !p.paused && !!this.current,
      position: p.timePos,
      duration: p.duration,
      volume: p.volume,
      muted: p.muted,
      shuffle: this.shuffle,
      repeat: p.repeatMode,
    });
  }

  private emitPlaylists() {
    this.emitEvent({ type: 'playlists-changed', playlists: this.library.playlists });
  }

  private emitQueue(type: 'queue-changed' | 'queue-refilled') {
    this.emitEvent({
      type,
      queue: this.queue.snapshot(),
      manualCount: this.queue.manualCount(),
      radioCount: this.queue.radioCount(),
    });
  }

  private emitEvent(event: MeloEvent) {
    this.emit(event.type, event);
  }
}
