import { join } from 'path';
import { unlinkSync } from 'fs';
import { getMusicDir } from '../../platform';
import { getYtdlpPrivacyArgs } from '../../privacy';
import { requireRuntimeBinary } from '../runtime/binaries';
import type { JsonStore } from '../persistence/json-store';
import type { AppSettings, Playlist, Track } from '../types';
import { log, logError } from '../log';

export type Settings = AppSettings;

export const DEFAULT_SETTINGS: Settings = {
  lang: 'en',
  autoplay: true,
  closeBehavior: 'quit',
  startMinimized: false,
  minimizeToTray: false,
  miniAlwaysOnTop: true,
};

function stripUndefined<T extends object>(raw: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

function mergeSettings(raw: Partial<Settings> | undefined): Settings {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(raw && typeof raw === 'object' ? stripUndefined(raw) : {}),
  };
  return {
    lang: typeof merged.lang === 'string' && merged.lang ? merged.lang : DEFAULT_SETTINGS.lang,
    autoplay: merged.autoplay !== false,
    closeBehavior: merged.closeBehavior === 'tray' ? 'tray' : 'quit',
    startMinimized: merged.startMinimized === true,
    minimizeToTray: merged.minimizeToTray === true,
    miniAlwaysOnTop: merged.miniAlwaysOnTop !== false,
  };
}

export class LibraryService {
  playlists: Playlist[] = [];
  downloads: Track[] = [];
  downloading = new Set<string>();
  settings: Settings = { ...DEFAULT_SETTINGS };
  readonly musicDir = getMusicDir();

  constructor(private readonly store: JsonStore) {
    this.playlists = this.normalizePlaylists(this.store.read<Playlist[]>('playlists.json', []));
    this.downloads = this.store.read<Track[]>('downloads.json', []);
    this.settings = mergeSettings(this.store.read<Partial<Settings>>('settings.json', DEFAULT_SETTINGS));
  }

  saveSettings(settings: Partial<Settings>) {
    this.settings = mergeSettings({ ...this.settings, ...stripUndefined(settings) });
    this.store.write('settings.json', this.settings);
  }

  createPlaylist(name: string): Playlist {
    const trimmed = name.trim() || 'Untitled playlist';
    const playlist: Playlist = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      tracks: [],
      createdAt: new Date().toISOString(),
    };
    this.playlists = [...this.playlists, playlist];
    this.persistPlaylists();
    return playlist;
  }

  deletePlaylist(id: string): void {
    this.playlists = this.playlists.filter(playlist => playlist.id !== id);
    this.persistPlaylists();
  }

  renamePlaylist(id: string, name: string): void {
    const playlist = this.playlists.find(item => item.id === id);
    if (!playlist) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    playlist.name = trimmed;
    this.persistPlaylists();
  }

  addToPlaylist(playlistId: string, track: Track): boolean {
    const playlist = this.playlists.find(item => item.id === playlistId);
    if (!playlist || !track?.id) return false;
    if (playlist.tracks.some(item => item.id === track.id)) return false;
    playlist.tracks.push(track);
    this.persistPlaylists();
    return true;
  }

  removeFromPlaylist(playlistId: string, index: number): void {
    const playlist = this.playlists.find(item => item.id === playlistId);
    if (!playlist) return;
    if (index < 0 || index >= playlist.tracks.length) return;
    playlist.tracks.splice(index, 1);
    this.persistPlaylists();
  }

  reorderPlaylist(playlistId: string, from: number, to: number): boolean {
    const playlist = this.playlists.find(item => item.id === playlistId);
    if (!playlist) return false;
    if (from < 0 || to < 0 || from >= playlist.tracks.length || to >= playlist.tracks.length) return false;
    const [item] = playlist.tracks.splice(from, 1);
    if (!item) return false;
    playlist.tracks.splice(to, 0, item);
    this.persistPlaylists();
    return true;
  }

  playlistById(id: string): Playlist | undefined {
    return this.playlists.find(item => item.id === id);
  }

  private persistPlaylists() {
    this.store.write('playlists.json', this.playlists);
  }

  private normalizePlaylists(raw: Playlist[]): Playlist[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap(item => {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.name !== 'string') return [];
      const tracks = Array.isArray(item.tracks) ? item.tracks.filter(track => track && typeof track.id === 'string') : [];
      return [{ ...item, tracks, createdAt: item.createdAt || new Date(0).toISOString() }];
    });
  }

  isDownloaded(id: string): boolean {
    return this.downloads.some(track => track.id === id);
  }

  localPath(id: string): string {
    return join(this.musicDir, `${id}.mp3`);
  }

  toggleDownload(track: Track, onEvent: (event: 'started' | 'completed' | 'removed') => void): void {
    if (this.isDownloaded(track.id)) {
      this.downloads = this.downloads.filter(item => item.id !== track.id);
      this.store.write('downloads.json', this.downloads);
      try { unlinkSync(this.localPath(track.id)); } catch {}
      onEvent('removed');
      return;
    }

    if (this.downloading.has(track.id)) return;
    this.downloading.add(track.id);
    onEvent('started');

    let ytdlp: string;
    try {
      ytdlp = requireRuntimeBinary('yt-dlp');
    } catch (error) {
      this.downloading.delete(track.id);
      logError('app', error instanceof Error ? error.message : String(error));
      onEvent('removed');
      return;
    }
    Bun.spawn([
      ytdlp,
      ...getYtdlpPrivacyArgs(),
      '-x',
      '--audio-format',
      'mp3',
      '-o',
      this.localPath(track.id),
      track.url,
    ], {
      stdout: 'ignore',
      stderr: 'ignore',
      onExit: (_proc, exitCode) => {
        this.downloading.delete(track.id);
        if (exitCode === 0) {
          if (!this.isDownloaded(track.id)) {
            this.downloads = [...this.downloads, track];
            this.store.write('downloads.json', this.downloads);
          }
          log('app', `downloaded ${track.id}`);
          onEvent('completed');
        } else {
          logError('app', `download failed ${track.id}`);
          onEvent('removed');
        }
      },
    });
  }
}
