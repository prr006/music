/**
 * Headless backend entry point for the Electron GUI.
 *
 * Starts the PlaybackEngine and ControlServer without any terminal UI,
 * allowing the Electron main process to manage it as a child process.
 *
 * Usage:
 *   bun run src/backend-headless.ts          (dev mode)
 *   ./backend-headless                       (packaged mode)
 */

import { PlaybackEngine } from './engine';
import { ControlServer, type ControlCommand, type ControlResponse, type ControlDataResponse } from './control';
import { setLang } from './i18n';
import { ensureRuntimeDependencies } from './dependencies';
import type { Track } from './types';
import { join } from 'path';
import { existsSync } from 'fs';

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function log(message: string) {
  process.stdout.write(`[backend] ${message}\n`);
}

function logError(message: string) {
  process.stderr.write(`[backend] ERROR: ${message}\n`);
}

// ─── State ────────────────────────────────────────────────────────────────

let currentTrack: Track | null = null;
let controlServer: ControlServer | null = null;
let engine: PlaybackEngine;
let playerStarted = false;
let isCleaningUp = false;

// ─── Status helper ────────────────────────────────────────────────────────

function statusText(): string {
  if (!currentTrack) {
    return [
      'State: stopped',
      `Volume: ${engine.volume}%${engine.state.muted ? ' (muted)' : ''}`,
      `Shuffle: ${engine.shuffleMode ? 'on' : 'off'}`,
      `Repeat: ${engine.state.repeatMode}`,
      `Queue: ${engine.queue.length}`,
    ].join('\n');
  }

  return [
    `Song: ${currentTrack.title}`,
    currentTrack.uploader ? `Artist: ${currentTrack.uploader}` : null,
    `State: ${engine.state.paused ? 'paused' : 'playing'}`,
    `Position: ${formatTime(engine.state.timePos)} / ${formatTime(engine.state.duration)}`,
    `Volume: ${engine.volume}%${engine.state.muted ? ' (muted)' : ''}`,
    `Shuffle: ${engine.shuffleMode ? 'on' : 'off'}`,
    `Repeat: ${engine.state.repeatMode}`,
    `Queue: ${engine.queue.length}`,
  ].filter(Boolean).join('\n');
}

function currentTrackOrThrow(): Track {
  if (!currentTrack) throw new Error('Nothing is playing.');
  return currentTrack;
}

// ─── Control command handler ──────────────────────────────────────────────

async function handleControlCommand(command: ControlCommand): Promise<ControlResponse | ControlDataResponse> {
  switch (command.type) {
    case 'play': {
      const [firstResult] = await engine.searchTracks(command.query, 1);
      if (!firstResult) throw new Error(`No results found for "${command.query}".`);
      await engine.play(firstResult);
      currentTrack = firstResult;
      return { ok: true, message: `Playing: ${firstResult.title}` };
    }
    case 'play-track': {
      await engine.play(command.track);
      currentTrack = command.track;
      return { ok: true, message: `Playing: ${command.track.title}` };
    }
    case 'mute': {
      const muted = await engine.toggleMute();
      return { ok: true, message: muted ? 'Muted.' : 'Unmuted.' };
    }
    case 'next':
      if (!await engine.playNextTrack()) throw new Error('The queue is empty.');
      return { ok: true, message: `Playing: ${engine.currentTrack!.title}` };
    case 'previous':
      if (!await engine.playPreviousTrack()) throw new Error('There is no previous song.');
      return { ok: true, message: `Playing: ${engine.currentTrack!.title}` };
    case 'pause':
      currentTrackOrThrow();
      await engine.setPaused(true);
      return { ok: true, message: 'Paused.' };
    case 'resume':
      currentTrackOrThrow();
      await engine.setPaused(false);
      return { ok: true, message: 'Resumed.' };
    case 'toggle':
      currentTrackOrThrow();
      await engine.togglePause();
      return { ok: true, message: engine.state.paused ? 'Paused.' : 'Resumed.' };
    case 'volume': {
      const base = command.relative ? Number(await engine.getVolume()) : 0;
      const nextVolume = await engine.setVolume(command.relative ? base + command.value : command.value);
      return { ok: true, message: `Volume: ${nextVolume}%` };
    }
    case 'seek':
      currentTrackOrThrow();
      await engine.seek(command.seconds);
      return { ok: true, message: `Seeked ${command.seconds > 0 ? '+' : ''}${command.seconds}s.` };
    case 'now': {
      const track = currentTrackOrThrow();
      const artist = track.uploader ? ` — ${track.uploader}` : '';
      return {
        ok: true,
        message: `${track.title}${artist}\n${formatTime(engine.state.timePos)} / ${formatTime(engine.state.duration)}\n${track.url}`,
      };
    }
    case 'status':
      return { ok: true, message: statusText() };
    case 'shuffle': {
      const enabled = command.enabled ?? !engine.shuffleMode;
      engine.setShuffle(enabled);
      return { ok: true, message: `Shuffle: ${enabled ? 'on' : 'off'}` };
    }
    case 'repeat':
      await engine.setRepeatMode(command.mode);
      return { ok: true, message: `Repeat: ${command.mode}` };
    case 'favorite': {
      // Default to the currently playing track (TUI/CLI behavior), but allow
      // the GUI to pass a specific track so users can unfavorite directly
      // from the library list.
      const track = command.track ?? currentTrackOrThrow();
      const added = engine.toggleFavorite(track);
      return { ok: true, message: added ? 'Added to favorites.' : 'Removed from favorites.' };
    }
    case 'download': {
      const track = currentTrackOrThrow();
      if (engine.isDownloaded(track.id)) return { ok: true, message: 'Already downloaded.' };
      if (engine.isDownloading(track.id)) return { ok: true, message: 'Download already in progress.' };
      engine.toggleDownload(track);
      return { ok: true, message: `Downloading: ${track.title}` };
    }
    case 'queue':
      if (command.clear) {
        engine.clearQueue();
        return { ok: true, message: 'Queue cleared.' };
      }
      if (engine.queue.length === 0) return { ok: true, message: 'Queue is empty.' };
      return {
        ok: true,
        message: engine.queue.map((qi, index) =>
          `${index + 1}. ${qi.track.title}${qi.track.uploader ? ` — ${qi.track.uploader}` : ''}`
        ).join('\n'),
      };
    case 'stop':
      await engine.stop();
      currentTrack = null;
      return { ok: true, message: 'Playback stopped.' };
    case 'quit':
      setTimeout(() => {
        void cleanup().finally(() => process.exit(0));
      }, 50);
      return { ok: true, message: 'Closing ytmusic-player.' };
    case 'add-to-queue': {
      engine.addToQueue(command.track);
      return { ok: true, message: `Added to queue: ${command.track.title}` };
    }
    case 'play-next': {
      engine.playNext(command.track);
      return { ok: true, message: `Will play next: ${command.track.title}` };
    }
    case 'remove-from-queue': {
      engine.removeFromQueue(command.index);
      return { ok: true, message: 'Removed from queue.' };
    }
    case 'get-queue': {
      return {
        ok: true,
        message: engine.queue.map((qi, i) =>
          `${i + 1}. [${qi.source}] ${qi.track.title}${qi.track.uploader ? ` — ${qi.track.uploader}` : ''}`
        ).join('\n'),
        data: engine.queue,
      } satisfies ControlDataResponse;
    }
    case 'get-state': {
      return {
        ok: true,
        message: statusText(),
        data: {
          currentTrack: engine.currentTrack,
          queue: engine.queue,
          history: engine.history,
          volume: engine.volume,
          muted: engine.state.muted,
          paused: engine.state.paused,
          timePos: engine.state.timePos,
          duration: engine.state.duration,
          shuffle: engine.shuffleMode,
          repeat: engine.state.repeatMode,
          favorites: engine.favorites,
          playlists: engine.playlists,
          downloads: engine.downloads,
        },
      } satisfies ControlDataResponse;
    }
    case 'subscribe':
      return { ok: true, message: 'Subscribed.' };
    case 'search': {
      const tracks = await engine.searchTracks(command.query, command.limit);
      return {
        ok: true,
        message: tracks.map((t, i) =>
          `${i + 1}. ${t.title}${t.uploader ? ` — ${t.uploader}` : ''}`
        ).join('\n'),
        data: tracks,
      } satisfies ControlDataResponse;
    }
    default:
      throw new Error(`Unsupported control command: type=${(command as any).type}`);
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────

async function cleanup() {
  if (isCleaningUp) return;
  isCleaningUp = true;
  log('Shutting down...');
  try { await controlServer?.stop(); } catch {}
  controlServer = null;
  if (playerStarted) await engine.quit();
  log('Backend stopped.');
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  log('Starting headless backend...');

  // Ensure mpv and yt-dlp are available
  await ensureRuntimeDependencies();

  // Initialize engine
  engine = new PlaybackEngine();

  const settings = engine.loadSettings();
  setLang(settings.lang);

  await engine.start();
  playerStarted = true;
  log('Playback engine started.');

  // Track current track
  engine.on('track-changed', (event: any) => {
    currentTrack = event.track;
  });

  // Start control server
  controlServer = new ControlServer(handleControlCommand);
  await controlServer.start();
  log(`Control server listening on ${controlServer.path}`);

  // Forward engine events to control socket subscribers
  const forwardEvent = (event: any) => {
    if (event && typeof event === 'object' && 'type' in event) {
      controlServer?.broadcast(event);
    }
  };
  engine.on('track-changed', forwardEvent);
  engine.on('playback-state', forwardEvent);
  engine.on('queue-changed', forwardEvent);
  engine.on('queue-refilled', forwardEvent);
  engine.on('volume-changed', forwardEvent);
  engine.on('shuffle-changed', forwardEvent);
  engine.on('repeat-changed', forwardEvent);

  // Signal handlers
  const handleExit = async () => {
    await cleanup();
    process.exit(0);
  };

  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);
  process.on('SIGHUP', handleExit);
  process.on('SIGUSR2', handleExit);

  process.on('uncaughtException', async (err) => {
    logError(`Uncaught exception: ${err.message}`);
    await cleanup();
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    logError(`Unhandled rejection: ${reason}`);
    await cleanup();
    process.exit(1);
  });

  // Signal readiness
  log('READY');
}

main().catch(async (e) => {
  const message = e instanceof Error ? e.message : String(e);
  logError(`Startup failed: ${message}`);
  if (playerStarted || controlServer) await cleanup();
  process.exit(1);
});
