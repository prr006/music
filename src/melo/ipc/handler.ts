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
          return { ok: true, message: 'Closing ytmusic-player.' };
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
