import type { ControlCommand } from '../../cli';
import type { MeloApp } from '../app';
import type { ControlResponse } from './control-server';
import { logError } from '../log';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function statusText(app: MeloApp): string {
  const state = app.snapshot();
  if (!state.currentTrack) {
    return [
      'State: stopped',
      `Volume: ${state.volume}%${state.muted ? ' (muted)' : ''}`,
      `Shuffle: ${state.shuffle ? 'on' : 'off'}`,
      `Repeat: ${state.repeat}`,
      `Queue: ${state.queue.length}`,
    ].join('\n');
  }
  return [
    `Song: ${state.currentTrack.title}`,
    state.currentTrack.uploader ? `Artist: ${state.currentTrack.uploader}` : null,
    `State: ${state.paused ? 'paused' : 'playing'}`,
    `Position: ${formatTime(state.timePos)} / ${formatTime(state.duration)}`,
    `Volume: ${state.volume}%${state.muted ? ' (muted)' : ''}`,
    `Shuffle: ${state.shuffle ? 'on' : 'off'}`,
    `Repeat: ${state.repeat}`,
    `Queue: ${state.queue.length}`,
  ].filter(Boolean).join('\n');
}

export function createControlHandler(app: MeloApp, onQuit: () => void) {
  return async function handle(command: ControlCommand): Promise<ControlResponse> {
    try {
      switch (command.type) {
        case 'play': {
          const [first] = await app.searchTracks(command.query, 1);
          if (!first) return { ok: false, message: `No results found for "${command.query}".` };
          await app.play(first);
          return { ok: true, message: `Playing: ${first.title}` };
        }
        case 'play-track': {
          if (!command.track?.id || !command.track.title) {
            return { ok: false, message: 'play-track requires a track object.' };
          }
          await app.play(command.track);
          return { ok: true, message: `Playing: ${command.track.title}` };
        }
        case 'mute': {
          const muted = await app.toggleMute();
          return { ok: true, message: muted ? 'Muted.' : 'Unmuted.' };
        }
        case 'next':
          if (!await app.playNextTrack()) return { ok: false, message: 'The queue is empty.' };
          return { ok: true, message: `Playing: ${app.currentTrack!.title}` };
        case 'previous':
          if (!await app.playPreviousTrack()) return { ok: false, message: 'There is no previous song.' };
          return { ok: true, message: `Playing: ${app.currentTrack!.title}` };
        case 'pause':
          if (!app.currentTrack) return { ok: false, message: 'Nothing is playing.' };
          await app.setPaused(true);
          return { ok: true, message: 'Paused.' };
        case 'resume':
          if (!app.currentTrack) return { ok: false, message: 'Nothing is playing.' };
          await app.setPaused(false);
          return { ok: true, message: 'Resumed.' };
        case 'toggle':
          if (!app.currentTrack) return { ok: false, message: 'Nothing is playing.' };
          await app.togglePause();
          return { ok: true, message: app.state.paused ? 'Paused.' : 'Resumed.' };
        case 'volume': {
          const base = command.relative ? Number(await app.getVolume()) : 0;
          const nextVolume = await app.setVolume(command.relative ? base + command.value : command.value);
          return { ok: true, message: `Volume: ${nextVolume}%` };
        }
        case 'seek':
          if (!app.currentTrack) return { ok: false, message: 'Nothing is playing.' };
          await app.seek(command.seconds);
          return { ok: true, message: `Seeked ${command.seconds > 0 ? '+' : ''}${command.seconds}s.` };
        case 'now': {
          const track = app.currentTrack;
          if (!track) return { ok: false, message: 'Nothing is playing.' };
          const artist = track.uploader ? ` — ${track.uploader}` : '';
          return {
            ok: true,
            message: `${track.title}${artist}\n${formatTime(app.state.timePos)} / ${formatTime(app.state.duration)}\n${track.url}`,
          };
        }
        case 'status':
          return { ok: true, message: statusText(app) };
        case 'shuffle': {
          const enabled = command.enabled ?? !app.shuffleMode;
          app.setShuffle(enabled);
          return { ok: true, message: `Shuffle: ${enabled ? 'on' : 'off'}` };
        }
        case 'repeat':
          await app.setRepeatMode(command.mode);
          return { ok: true, message: `Repeat: ${command.mode}` };
        case 'favorite': {
          const track = command.track ?? app.currentTrack;
          if (!track) return { ok: false, message: 'Nothing is playing.' };
          const added = app.toggleFavorite(track);
          return { ok: true, message: added ? 'Added to favorites.' : 'Removed from favorites.' };
        }
        case 'download': {
          const track = app.currentTrack;
          if (!track) return { ok: false, message: 'Nothing is playing.' };
          if (app.isDownloaded(track.id)) return { ok: true, message: 'Already downloaded.' };
          if (app.isDownloading(track.id)) return { ok: true, message: 'Download already in progress.' };
          app.toggleDownload(track);
          return { ok: true, message: `Downloading: ${track.title}` };
        }
        case 'queue':
          if (command.clear) {
            app.clearQueue();
            return { ok: true, message: 'Queue cleared.' };
          }
          if (app.queue.length === 0) return { ok: true, message: 'Queue is empty.' };
          return {
            ok: true,
            message: app.queue.snapshot().map((item, index) =>
              `${index + 1}. ${item.track.title}${item.track.uploader ? ` — ${item.track.uploader}` : ''}`,
            ).join('\n'),
          };
        case 'stop':
          await app.stop();
          return { ok: true, message: 'Playback stopped.' };
        case 'quit':
          setTimeout(onQuit, 50);
          return { ok: true, message: 'Closing MELO.' };
        case 'add-to-queue': {
          if (!command.track?.id) return { ok: false, message: 'add-to-queue requires a track.' };
          app.addToQueue(command.track);
          return { ok: true, message: `Added to queue: ${command.track.title}` };
        }
        case 'play-next': {
          if (!command.track?.id) return { ok: false, message: 'play-next requires a track.' };
          app.playNext(command.track);
          return { ok: true, message: `Will play next: ${command.track.title}` };
        }
        case 'remove-from-queue': {
          if (!Number.isInteger(command.index)) return { ok: false, message: 'remove-from-queue requires an index.' };
          app.removeFromQueue(command.index);
          return { ok: true, message: 'Removed from queue.' };
        }
        case 'move-queue': {
          if (!Number.isInteger(command.from) || !Number.isInteger(command.to)) {
            return { ok: false, message: 'move-queue requires from and to indexes.' };
          }
          if (!app.moveQueue(command.from, command.to)) return { ok: false, message: 'Could not move queue item.' };
          return { ok: true, message: 'Queue updated.' };
        }
        case 'play-from-queue': {
          if (!Number.isInteger(command.index)) return { ok: false, message: 'play-from-queue requires an index.' };
          if (!await app.playFromQueue(command.index)) return { ok: false, message: 'That queue item is gone.' };
          return { ok: true, message: `Playing: ${app.currentTrack!.title}` };
        }
        case 'get-lyrics': {
          const track = command.track ?? app.currentTrack;
          if (!track) return { ok: true, message: 'No lyrics.', data: { trackId: '', lines: [] } };
          const lyrics = await app.lyricsFor(track);
          return {
            ok: true,
            message: lyrics.lines.length > 0 ? 'Lyrics ready.' : 'No lyrics found.',
            data: lyrics,
          };
        }
        case 'get-playlists':
          return { ok: true, message: `${app.playlists.length} playlists.`, data: app.playlists };
        case 'create-playlist': {
          const name = command.name?.trim();
          if (!name) return { ok: false, message: 'create-playlist requires a name.' };
          const playlist = app.createPlaylist(name);
          return { ok: true, message: `Created playlist: ${playlist.name}`, data: playlist };
        }
        case 'delete-playlist': {
          if (!command.id) return { ok: false, message: 'delete-playlist requires an id.' };
          app.deletePlaylistById(command.id);
          return { ok: true, message: 'Playlist deleted.' };
        }
        case 'rename-playlist': {
          if (!command.id || !command.name?.trim()) return { ok: false, message: 'rename-playlist requires id and name.' };
          app.renamePlaylistById(command.id, command.name);
          return { ok: true, message: 'Playlist renamed.' };
        }
        case 'add-to-playlist': {
          if (!command.id || !command.track?.id) return { ok: false, message: 'add-to-playlist requires a playlist and track.' };
          const added = app.addTrackToPlaylist(command.id, command.track);
          return { ok: added, message: added ? 'Added to playlist.' : 'Already in playlist or missing playlist.' };
        }
        case 'remove-from-playlist': {
          if (!command.id || !Number.isInteger(command.index)) return { ok: false, message: 'remove-from-playlist requires id and index.' };
          app.removeTrackFromPlaylist(command.id, command.index);
          return { ok: true, message: 'Removed from playlist.' };
        }
        case 'reorder-playlist': {
          if (!command.id || !Number.isInteger(command.from) || !Number.isInteger(command.to)) {
            return { ok: false, message: 'reorder-playlist requires id, from, and to.' };
          }
          if (!app.reorderPlaylist(command.id, command.from, command.to)) return { ok: false, message: 'Could not reorder playlist.' };
          return { ok: true, message: 'Playlist updated.' };
        }
        case 'play-playlist': {
          if (!command.id) return { ok: false, message: 'play-playlist requires an id.' };
          if (!await app.playPlaylist(command.id, command.index ?? 0)) return { ok: false, message: 'Playlist is empty.' };
          return { ok: true, message: `Playing: ${app.currentTrack!.title}` };
        }
        case 'save-queue-as-playlist': {
          const name = command.name?.trim();
          if (!name) return { ok: false, message: 'save-queue-as-playlist requires a name.' };
          const playlist = app.saveQueueAsPlaylist(name);
          return { ok: true, message: `Saved playlist: ${playlist.name}`, data: playlist };
        }
        case 'clear-history':
          app.clearHistory();
          return { ok: true, message: 'History cleared.' };
        case 'get-settings':
          return { ok: true, message: 'Settings.', data: app.loadSettings() };
        case 'save-settings': {
          if (!command.settings || typeof command.settings !== 'object') {
            return { ok: false, message: 'save-settings requires a settings object.' };
          }
          const raw = command.settings;
          app.saveSettings({
            lang: typeof raw.lang === 'string' ? raw.lang : undefined,
            autoplay: typeof raw.autoplay === 'boolean' ? raw.autoplay : undefined,
            closeBehavior: raw.closeBehavior === 'tray' || raw.closeBehavior === 'quit' ? raw.closeBehavior : undefined,
            startMinimized: typeof raw.startMinimized === 'boolean' ? raw.startMinimized : undefined,
            minimizeToTray: typeof raw.minimizeToTray === 'boolean' ? raw.minimizeToTray : undefined,
            miniAlwaysOnTop: typeof raw.miniAlwaysOnTop === 'boolean' ? raw.miniAlwaysOnTop : undefined,
          });
          return { ok: true, message: 'Settings saved.', data: app.loadSettings() };
        }
        case 'get-queue': {
          const queue = app.queue.snapshot();
          return {
            ok: true,
            message: queue.map((item, i) =>
              `${i + 1}. [${item.source}] ${item.track.title}${item.track.uploader ? ` — ${item.track.uploader}` : ''}`,
            ).join('\n'),
            data: queue,
          };
        }
        case 'get-state': {
          const state = app.snapshot();
          return {
            ok: true,
            message: statusText(app),
            data: state,
          };
        }
        case 'subscribe':
          return { ok: true, message: 'Subscribed.' };
        case 'search': {
          const query = command.query?.trim() ?? '';
          if (!query) return { ok: true, message: '', data: [] };
          try {
            const tracks = await app.searchTracks(query, command.limit);
            return {
              ok: true,
              message: tracks.map((track, i) =>
                `${i + 1}. ${track.title}${track.uploader ? ` — ${track.uploader}` : ''}`,
              ).join('\n'),
              data: tracks,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, message, data: [] };
          }
        }
        default:
          return { ok: false, message: `Unsupported control command: type=${(command as { type: string }).type}` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError('ipc', message);
      return { ok: false, message };
    }
  };
}
