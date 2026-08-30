import { join } from 'path';
import { unlinkSync } from 'fs';
import { getMusicDir, resolveCommand } from '../../platform';
import { getYtdlpPrivacyArgs } from '../../privacy';
import type { JsonStore } from '../persistence/json-store';
import type { Playlist, Track } from '../types';
import { log, logError } from '../log';

export interface Settings {
  lang: string;
}

export class LibraryService {
  playlists: Playlist[] = [];
  downloads: Track[] = [];
  downloading = new Set<string>();
  settings: Settings = { lang: 'en' };
  readonly musicDir = getMusicDir();

  constructor(private readonly store: JsonStore) {
    this.playlists = this.store.read<Playlist[]>('playlists.json', []);
    this.downloads = this.store.read<Track[]>('downloads.json', []);
    this.settings = this.store.read<Settings>('settings.json', { lang: 'en' });
  }

  saveSettings(settings: Settings) {
    this.settings = settings;
    this.store.write('settings.json', settings);
  }

  createPlaylist(name: string): Playlist {
    const playlist: Playlist = {
      id: Date.now().toString(36),
      name,
      tracks: [],
      createdAt: new Date().toISOString(),
    };
    this.playlists = [...this.playlists, playlist];
    this.store.write('playlists.json', this.playlists);
    return playlist;
  }

  deletePlaylist(id: string): void {
    this.playlists = this.playlists.filter(playlist => playlist.id !== id);
    this.store.write('playlists.json', this.playlists);
  }

  renamePlaylist(id: string, name: string): void {
    const playlist = this.playlists.find(item => item.id === id);
    if (!playlist) return;
    playlist.name = name;
    this.store.write('playlists.json', this.playlists);
  }

  addToPlaylist(playlistId: string, track: Track): boolean {
    const playlist = this.playlists.find(item => item.id === playlistId);
    if (!playlist) return false;
    if (playlist.tracks.some(item => item.id === track.id)) return false;
    playlist.tracks.push(track);
    this.store.write('playlists.json', this.playlists);
    return true;
  }

  removeFromPlaylist(playlistId: string, index: number): void {
    const playlist = this.playlists.find(item => item.id === playlistId);
    if (!playlist) return;
    playlist.tracks.splice(index, 1);
    this.store.write('playlists.json', this.playlists);
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

    const ytdlp = resolveCommand('yt-dlp') ?? 'yt-dlp';
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
