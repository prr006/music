import { MeloApp } from './melo/app';
import { renderSearch, renderResults, renderPlayer, renderFavorites, clearScreen, renderPlaylistList, renderPlaylistDetail, renderPlaylistPicker, renderNewPlaylistInput, renderRenamePlaylistInput, renderLanguagePicker, renderDownloads } from './ui';
import type { Track, Playlist } from './types';
import { setLang, getLang, t, LANGS, type Lang } from './i18n';
import { ensureRuntimeDependencies } from './dependencies';
import { CLI_HELP, parseCliArgs, type CliCommand, type ControlCommand } from './cli';
import { ControlServer, ControlUnavailableError, sendControlCommand, type ControlResponse, type ControlDataResponse } from './control';
import packageJson from '../package.json';

// Arrow keys & special keys
const UP = '\x1B[A';
const DOWN = '\x1B[B';
const LEFT = '\x1B[D';
const RIGHT = '\x1B[C';
const VOLUME_STEP = 5;
const VERSION = packageJson.version;

let cliCommand: CliCommand;
try {
  cliCommand = parseCliArgs(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`melo: ${message}\n\n${CLI_HELP}\n`);
  process.exit(1);
}

if (cliCommand.action === 'version') {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

if (cliCommand.action === 'help') {
  process.stdout.write(`${CLI_HELP}\n`);
  process.exit(0);
}

type AppState = 'search-input' | 'search-results' | 'playing' | 'favorites' | 'playlist-list' | 'playlist-detail' | 'playlist-picker' | 'new-playlist' | 'rename-playlist' | 'language-picker' | 'downloads' | 'help' | 'queue-view' | 'track-info';

let appState: AppState = 'search-input';
let searchMode: 'typing' | 'command' = 'typing';
let searchQuery = '';
let results: Track[] = [];
let selectedIdx = 0;
let currentTrack: Track | null = null;
let favSelectedIdx = 0;
let dlSelectedIdx = 0;
let plSelectedIdx = 0;
let plDetailIdx = 0;
let currentPlaylist: Playlist | null = null;
let plPickerIdx = 0;
let newPlaylistName = '';
let renamePlaylistName = '';
let renamingPlaylistId = '';
let prePlaylistState: AppState = 'playing';
let preLanguageState: AppState = 'playing';
let preHelpState: AppState = 'playing';
let preQueueState: AppState = 'playing';
let preTrackInfoState: AppState = 'playing';
let preListViewState: AppState = 'search-input';
let langPickerIdx = 0;
let renderTimer: ReturnType<typeof setInterval> | null = null;
let controlServer: ControlServer | null = null;
let playerStarted = false;
let terminalStarted = false;

// ─── Engine ───────────────────────────────────────────────────────────────

const engine = new MeloApp();

// ─── Engine event listeners ───────────────────────────────────────────────

engine.on('track-changed', (event) => {
  currentTrack = event.track;
  if (event.track && appState !== 'playing') {
    appState = 'playing';
  }
  startRenderTimer();
  renderPlayerNow();
});

engine.on('queue-changed', () => {
  renderPlayerNow();
});

engine.on('queue-refilled', () => {
  renderPlayerNow();
});

engine.on('volume-changed', () => {
  renderPlayerNow();
});

engine.on('shuffle-changed', () => {
  renderPlayerNow();
});

engine.on('repeat-changed', () => {
  renderPlayerNow();
});

engine.on('favorites-changed', () => {
  renderCurrentScreen();
});

engine.on('download-started', () => {
  renderCurrentScreen();
});

engine.on('download-completed', () => {
  renderCurrentScreen();
});

engine.on('download-removed', () => {
  renderCurrentScreen();
});

// ─── Control server events → broadcast to subscribers ─────────────────────

function broadcastToSubscribers(eventType: string, data?: unknown) {
  if (!controlServer) return;
  // The control server broadcasts engine events to subscribed clients (GUI)
  // This is handled by engine.on → controlServer.broadcast in setupControlBroadcast()
}

// ─── State transitions ────────────────────────────────────────────────────

function goToSearch() {
  appState = 'search-input';
  searchQuery = '';
  searchMode = 'typing';
  if (renderTimer) { clearInterval(renderTimer); renderTimer = null; }
  renderSearch('', '', searchMode);
}

function renderCurrentScreen() {
  switch (appState) {
    case 'search-input':
      renderSearch(searchQuery, '', searchMode);
      break;
    case 'search-results':
      renderResults(results, selectedIdx, new Set(engine.favorites.map(t => t.id)), new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
      break;
    case 'playing':
      if (currentTrack) {
        renderPlayer(engine.state, currentTrack, engine.queue.map(qi => qi.track), engine.fetchingMix, engine.isFavorite(currentTrack.id), engine.shuffleMode, engine.volume, engine.isDownloaded(currentTrack.id), engine.isDownloading(currentTrack.id));
      } else {
        goToSearch();
      }
      break;
    case 'favorites':
      renderFavorites(engine.favorites, favSelectedIdx, new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
      break;
    case 'downloads':
      renderDownloads(engine.downloads, dlSelectedIdx, new Set(engine.favorites.map(t => t.id)));
      break;
    case 'playlist-list':
      renderPlaylistList(engine.playlists, plSelectedIdx, engine.downloads.length, engine.favorites.length);
      break;
    case 'playlist-detail':
      if (currentPlaylist) renderPlaylistDetail(currentPlaylist, plDetailIdx, new Set(engine.favorites.map(t => t.id)), new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
      break;
    case 'playlist-picker':
      if (currentTrack) renderPlaylistPicker(engine.playlists, plPickerIdx, currentTrack.title);
      break;
    case 'new-playlist':
      renderNewPlaylistInput(newPlaylistName);
      break;
    case 'rename-playlist':
      renderRenamePlaylistInput(renamePlaylistName);
      break;
    case 'language-picker':
      renderLanguagePicker(LANGS, langPickerIdx);
      break;
    case 'help':
      import('./ui').then(ui => ui.renderHelp());
      break;
    case 'queue-view':
      import('./ui').then(ui => ui.renderQueue(engine.queue.map(qi => qi.track), currentTrack || undefined));
      break;
    case 'track-info':
      if (currentTrack) import('./ui').then(ui => ui.renderTrackInfo(currentTrack!));
      break;
  }
}

function renderPlayerNow() {
  if (appState === 'playing' && currentTrack) {
    renderPlayer(engine.state, currentTrack, engine.queue.map(qi => qi.track), engine.fetchingMix, engine.isFavorite(currentTrack.id), engine.shuffleMode, engine.volume, engine.isDownloaded(currentTrack.id), engine.isDownloading(currentTrack.id));
  }
}

function startRenderTimer() {
  if (renderTimer) clearInterval(renderTimer);
  renderTimer = setInterval(() => {
    if (appState === 'playing' && currentTrack) {
      renderPlayer(engine.state, currentTrack!, engine.queue.map(qi => qi.track), engine.fetchingMix, engine.isFavorite(currentTrack.id), engine.shuffleMode, engine.volume, engine.isDownloaded(currentTrack.id), engine.isDownloading(currentTrack.id));
    }
  }, 1000);
}

function returnToPlayer() {
  if (preListViewState === 'search-input') {
    goToSearch();
    return;
  }

  if (currentTrack) {
    appState = 'playing';
    startRenderTimer();
    renderPlayerNow();
  } else {
    goToSearch();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function currentTrackOrThrow(): Track {
  if (!currentTrack) throw new Error('Nothing is playing.');
  return currentTrack;
}

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

// ─── Control command handler ──────────────────────────────────────────────

async function handleControlCommand(command: ControlCommand): Promise<ControlResponse | ControlDataResponse> {
  console.log('[DEBUG-CMD] handleControlCommand command.type:', command.type, 'keys:', Object.keys(command));
  switch (command.type) {
    case 'play': {
      const [firstResult] = await engine.searchTracks(command.query, 1);
      if (!firstResult) throw new Error(`No results found for "${command.query}".`);
      await engine.play(firstResult);
      currentTrack = firstResult;
      appState = 'playing';
      startRenderTimer();
      renderPlayerNow();
      return { ok: true, message: `Playing: ${firstResult.title}` };
    }
    case 'play-track': {
      console.log('[DEBUG-CMD] handleControlCommand ENTERED play-track case, track:', JSON.stringify({ id: command.track.id, title: command.track.title }));
      await engine.play(command.track);
      currentTrack = command.track;
      appState = 'playing';
      startRenderTimer();
      renderPlayerNow();
      return { ok: true, message: `Playing: ${command.track.title}` };
    }
    case 'mute': {
      const muted = await engine.toggleMute();
      renderPlayerNow();
      return { ok: true, message: muted ? 'Muted.' : 'Unmuted.' };
    }
    case 'next':
      if (!await engine.playNextTrack()) throw new Error('The queue is empty.');
      appState = 'playing';
      startRenderTimer();
      renderPlayerNow();
      return { ok: true, message: `Playing: ${engine.currentTrack!.title}` };
    case 'previous':
      if (!await engine.playPreviousTrack()) throw new Error('There is no previous song.');
      appState = 'playing';
      startRenderTimer();
      renderPlayerNow();
      return { ok: true, message: `Playing: ${engine.currentTrack!.title}` };
    case 'pause':
      currentTrackOrThrow();
      await engine.setPaused(true);
      renderPlayerNow();
      return { ok: true, message: 'Paused.' };
    case 'resume':
      currentTrackOrThrow();
      await engine.setPaused(false);
      renderPlayerNow();
      return { ok: true, message: 'Resumed.' };
    case 'toggle':
      currentTrackOrThrow();
      await engine.togglePause();
      renderPlayerNow();
      return { ok: true, message: engine.state.paused ? 'Paused.' : 'Resumed.' };
    case 'volume': {
      const base = command.relative ? Number(await engine.getVolume()) : 0;
      const nextVolume = await engine.setVolume(command.relative ? base + command.value : command.value);
      renderPlayerNow();
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
      renderPlayerNow();
      return { ok: true, message: `Shuffle: ${enabled ? 'on' : 'off'}` };
    }
    case 'repeat':
      await engine.setRepeatMode(command.mode);
      renderPlayerNow();
      return { ok: true, message: `Repeat: ${command.mode}` };
    case 'favorite': {
      const track = command.track ?? currentTrackOrThrow();
      const added = engine.toggleFavorite(track);
      renderPlayerNow();
      return { ok: true, message: added ? 'Added to favorites.' : 'Removed from favorites.' };
    }
    case 'download': {
      const track = currentTrackOrThrow();
      if (engine.isDownloaded(track.id)) {
        return { ok: true, message: 'Already downloaded.' };
      }
      if (engine.isDownloading(track.id)) {
        return { ok: true, message: 'Download already in progress.' };
      }
      engine.toggleDownload(track);
      return { ok: true, message: `Downloading: ${track.title}` };
    }
    case 'queue':
      if (command.clear) {
        engine.clearQueue();
        renderCurrentScreen();
        return { ok: true, message: 'Queue cleared.' };
      }
      if (engine.queue.length === 0) return { ok: true, message: 'Queue is empty.' };
      return {
        ok: true,
        message: engine.queue.map((qi, index) => `${index + 1}. ${qi.track.title}${qi.track.uploader ? ` — ${qi.track.uploader}` : ''}`).join('\n'),
      };
    case 'stop':
      await engine.stop();
      goToSearch();
      return { ok: true, message: 'Playback stopped.' };
    case 'quit':
      setTimeout(() => {
        void cleanup().finally(() => process.exit(0));
      }, 50);
      return { ok: true, message: 'Closing MELO.' };
    // ─── Extended protocol commands ─────────────────────────────────────
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
        message: engine.queue.map((qi, i) => `${i + 1}. [${qi.source}] ${qi.track.title}${qi.track.uploader ? ` — ${qi.track.uploader}` : ''}`).join('\n'),
        data: engine.queue.snapshot(),
      } satisfies ControlDataResponse;
    }
    case 'get-state': {
      return {
        ok: true,
        message: statusText(),
        data: {
          currentTrack: engine.currentTrack,
          queue: engine.queue.snapshot(),
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
      // Handled by ControlServer directly — should not reach here
      return { ok: true, message: 'Subscribed.' };
    case 'search': {
      const tracks = await engine.searchTracks(command.query, command.limit);
      return {
        ok: true,
        message: tracks.map((t, i) => `${i + 1}. ${t.title}${t.uploader ? ` — ${t.uploader}` : ''}`).join('\n'),
        data: tracks,
      } satisfies ControlDataResponse;
    }
    default:
      console.log('[DEBUG-CMD] handleControlCommand DEFAULT CASE REACHED. Complete command object:', JSON.stringify(command));
      throw new Error(`Unsupported control command: type=${(command as any).type}`);
  }
}

// ─── Key handlers ─────────────────────────────────────────────────────────

async function handleKey(key: string) {
  if (key === '\x03') {  // Ctrl+C
    await cleanup();
    process.exit(0);
  }

  if (key === 'g' || key === 'G') {
    if (
      appState !== 'language-picker' &&
      appState !== 'new-playlist' &&
      appState !== 'rename-playlist' &&
      !(appState === 'search-input' && searchMode === 'typing')
    ) {
      preLanguageState = appState;
      appState = 'language-picker';
      langPickerIdx = LANGS.indexOf(getLang() as any);
      if (langPickerIdx === -1) langPickerIdx = 0;
      if (renderTimer) { clearInterval(renderTimer); renderTimer = null; }
      renderLanguagePicker(LANGS, langPickerIdx);
      return;
    }
  }

  if (key === 'h' || key === 'H') {
    const isTextInput =
      appState === 'new-playlist' ||
      appState === 'rename-playlist' ||
      (appState === 'search-input' && searchMode === 'typing');

    if (appState !== 'help' && !isTextInput) {
      preHelpState = appState;
      appState = 'help';
      if (renderTimer) { clearInterval(renderTimer); renderTimer = null; }
      import('./ui').then(ui => ui.renderHelp());
      return;
    }
  }

  if (appState === 'search-input') await onSearchInput(key);
  else if (appState === 'search-results') await onResultsKey(key);
  else if (appState === 'playing') await onPlayingKey(key);
  else if (appState === 'favorites') await onFavoritesKey(key);
  else if (appState === 'downloads') await onDownloadsKey(key);
  else if (appState === 'playlist-list') await onPlaylistListKey(key);
  else if (appState === 'playlist-detail') await onPlaylistDetailKey(key);
  else if (appState === 'playlist-picker') await onPlaylistPickerKey(key);
  else if (appState === 'new-playlist') onNewPlaylistKey(key);
  else if (appState === 'rename-playlist') onRenamePlaylistKey(key);
  else if (appState === 'language-picker') onLanguagePickerKey(key);
  else if (appState === 'help') onHelpKey(key);
  else if (appState === 'queue-view') onQueueKey(key);
  else if (appState === 'track-info') onTrackInfoKey(key);
}

async function onSearchInput(key: string) {
  // Command mode: shortcuts active, any character key returns to typing mode
  if (searchMode === 'command') {
    if (key === '\x1B') {
      // Stay in command mode on Escape
      return;
    }
    // Handle L (favorites) shortcut
    if ((key === 'l' || key === 'L') && !searchQuery) {
      preListViewState = 'search-input';
      appState = 'favorites';
      favSelectedIdx = 0;
      renderFavorites(engine.favorites, favSelectedIdx, new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
      return;
    }
    // Handle O (playlist) shortcut
    if ((key === 'o' || key === 'O') && !searchQuery) {
      preListViewState = 'search-input';
      appState = 'playlist-list';
      plSelectedIdx = 0;
      renderPlaylistList(engine.playlists, plSelectedIdx, engine.downloads.length, engine.favorites.length);
      return;
    }
    if ((key === 'd' || key === 'D') && !searchQuery) {
      preListViewState = 'search-input';
      appState = 'downloads';
      dlSelectedIdx = 0;
      renderDownloads(engine.downloads, dlSelectedIdx, new Set(engine.favorites.map(t => t.id)));
      return;
    }
    // Any character key switches back to typing mode
    if (key.length === 1 && key >= ' ') {
      searchMode = 'typing';
      searchQuery += key;
      renderSearch(searchQuery, '', searchMode);
      return;
    }
    return;
  }

  // Typing mode: Escape switches to command mode
  if (key === '\x1B') {
    searchMode = 'command';
    searchQuery = '';
    renderSearch(searchQuery, '', searchMode);
    return;
  }
  if (key === '\r' || key === '\n') {
    if (!searchQuery.trim()) return;
    renderSearch(t('searching'), `"${searchQuery}"`, searchMode);
    try {
      results = await engine.searchTracks(searchQuery);
      if (results.length === 0) {
        renderSearch('', t('noResults'), searchMode);
        return;
      }
      appState = 'search-results';
      selectedIdx = 0;
      renderResults(results, selectedIdx, new Set(engine.favorites.map(t => t.id)), new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
    } catch {
      renderSearch('', t('ytdlpError'), searchMode);
    }
  } else if (key === '\x7F' || key === '\b') {
    searchQuery = searchQuery.slice(0, -1);
    renderSearch(searchQuery, '', searchMode);
  } else if (key.length === 1 && key >= ' ') {
    searchQuery += key;
    renderSearch(searchQuery, '', searchMode);
  }
}

async function onResultsKey(key: string) {
  if (key === UP) {
    selectedIdx = Math.max(0, selectedIdx - 1);
    renderResults(results, selectedIdx, new Set(engine.favorites.map(t => t.id)), new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
  } else if (key === DOWN) {
    selectedIdx = Math.min(results.length - 1, selectedIdx + 1);
    renderResults(results, selectedIdx, new Set(engine.favorites.map(t => t.id)), new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
  } else if (key === '\r' || key === '\n') {
    // Play selected result
    await engine.play(results[selectedIdx]!);
    currentTrack = engine.currentTrack;
    appState = 'playing';
    startRenderTimer();
    renderPlayerNow();
  } else if (key === 'f' || key === 'F') {
    if (results.length > 0) {
      const tr = results[selectedIdx]!;
      engine.toggleFavorite(tr);
      renderResults(results, selectedIdx, new Set(engine.favorites.map(t => t.id)), new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
    }
  } else if (key === 'w' || key === 'W') {
    if (results.length > 0) {
      const tr = results[selectedIdx]!;
      engine.toggleDownload(tr);
    }
  } else if (key === 'q' || key === 'Q' || key === '\x1B') {
    goToSearch();
  } else if (key === 'l' || key === 'L') {
    preListViewState = 'search-results';
    appState = 'favorites';
    favSelectedIdx = 0;
    renderFavorites(engine.favorites, favSelectedIdx, new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
  } else if (key === 'o' || key === 'O') {
    preListViewState = 'search-results';
    appState = 'playlist-list';
    plSelectedIdx = 0;
    renderPlaylistList(engine.playlists, plSelectedIdx, engine.downloads.length, engine.favorites.length);
  } else if (key === 'd' || key === 'D') {
    preListViewState = 'search-results';
    appState = 'downloads';
    dlSelectedIdx = 0;
    renderDownloads(engine.downloads, dlSelectedIdx, new Set(engine.favorites.map(t => t.id)));
  }
}

async function onPlayingKey(key: string) {
  switch (key) {
    case ' ':
      await engine.togglePause();
      break;
    case 'n':
    case 'N':
      if (!await engine.playNextTrack()) break;
      appState = 'playing';
      break;
    case 'p':
    case 'P':
      if (!await engine.playPreviousTrack()) break;
      appState = 'playing';
      break;
    case LEFT:
      await engine.seek(-10);
      break;
    case RIGHT:
      await engine.seek(10);
      break;
    case 'f':
    case 'F':
      if (currentTrack) {
        engine.toggleFavorite(currentTrack);
        renderPlayerNow();
      }
      break;
    case 'l':
    case 'L':
      if (engine.favorites.length > 0) {
        preListViewState = appState;
        appState = 'favorites';
        favSelectedIdx = 0;
        if (renderTimer) { clearInterval(renderTimer); renderTimer = null; }
        renderFavorites(engine.favorites, favSelectedIdx, new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
      }
      break;
    case 'a':
    case 'A':
      if (currentTrack) {
        prePlaylistState = 'playing';
        appState = 'playlist-picker';
        plPickerIdx = 0;
        if (renderTimer) { clearInterval(renderTimer); renderTimer = null; }
        renderPlaylistPicker(engine.playlists, plPickerIdx, currentTrack.title);
      }
      break;
    case 'i':
    case 'I':
      if (currentTrack) {
        preTrackInfoState = appState;
        appState = 'track-info';
        if (renderTimer) { clearInterval(renderTimer); renderTimer = null; }
        import('./ui').then(ui => ui.renderTrackInfo(currentTrack!));
      }
      break;
    case 'o':
    case 'O':
      preListViewState = appState;
      appState = 'playlist-list';
      plSelectedIdx = 0;
      if (renderTimer) { clearInterval(renderTimer); renderTimer = null; }
      renderPlaylistList(engine.playlists, plSelectedIdx, engine.downloads.length, engine.favorites.length);
      break;
    case 'x':
    case 'X':
      engine.setShuffle(!engine.shuffleMode);
      renderPlayerNow();
      break;
    case 'd':
    case 'D':
      preListViewState = appState;
      appState = 'downloads';
      dlSelectedIdx = 0;
      if (renderTimer) { clearInterval(renderTimer); renderTimer = null; }
      renderDownloads(engine.downloads, dlSelectedIdx, new Set(engine.favorites.map(t => t.id)));
      break;
    case 's':
    case 'S':
      goToSearch();
      break;
    case '+':
    case '=':
      await engine.setVolume(engine.volume + VOLUME_STEP);
      renderPlayerNow();
      break;
    case '-':
    case '_':
      await engine.setVolume(engine.volume - VOLUME_STEP);
      renderPlayerNow();
      break;
    case 'w':
    case 'W':
      if (currentTrack) {
        engine.toggleDownload(currentTrack);
      }
      break;
    case 'r':
    case 'R':
      {
        const modes: ('off' | 'one' | 'all')[] = ['off', 'one', 'all'];
        const cur = modes.indexOf(engine.state.repeatMode);
        const next = modes[(cur + 1) % modes.length]!;
        await engine.setRepeatMode(next);
        renderPlayerNow();
      }
      break;
    case 'u':
    case 'U':
      preQueueState = appState;
      appState = 'queue-view';
      if (renderTimer) { clearInterval(renderTimer); renderTimer = null; }
      import('./ui').then(ui => ui.renderQueue(engine.queue.map(qi => qi.track), currentTrack || undefined));
      break;
    case 'q':
    case 'Q':
    case '\x1B':
      await cleanup();
      process.exit(0);
      break;
  }
}

function onHelpKey(key: string) {
  if (key === 'q' || key === 'Q' || key === '\x1B' || key === 'h' || key === 'H') {
    appState = preHelpState;
    if (appState === 'playing') {
      startRenderTimer();
    }
    renderCurrentScreen();
  }
}

function onQueueKey(key: string) {
  if (key === 'q' || key === 'Q' || key === '\x1B' || key === 'u' || key === 'U') {
    appState = preQueueState;
    if (appState === 'playing') {
      startRenderTimer();
    }
    renderCurrentScreen();
  }
}

function onTrackInfoKey(key: string) {
  if (key === 'q' || key === 'Q' || key === '\x1B' || key === 'i' || key === 'I') {
    appState = preTrackInfoState;
    if (appState === 'playing') {
      startRenderTimer();
    }
    renderCurrentScreen();
  }
}

async function onFavoritesKey(key: string) {
  if (key === UP && engine.favorites.length > 0) {
    favSelectedIdx = Math.max(0, favSelectedIdx - 1);
    renderFavorites(engine.favorites, favSelectedIdx, new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
  } else if (key === DOWN && engine.favorites.length > 0) {
    favSelectedIdx = Math.min(engine.favorites.length - 1, favSelectedIdx + 1);
    renderFavorites(engine.favorites, favSelectedIdx, new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
  } else if ((key === '\r' || key === '\n') && engine.favorites.length > 0) {
    await engine.play(engine.favorites[favSelectedIdx]!);
    currentTrack = engine.currentTrack;
    appState = 'playing';
    startRenderTimer();
    renderPlayerNow();
  } else if (key === 'f' || key === 'F') {
    if (engine.favorites.length > 0) {
      const tr = engine.favorites[favSelectedIdx]!;
      engine.toggleFavorite(tr);
      if (engine.favorites.length === 0) {
        appState = 'search-input';
        goToSearch();
      } else {
        favSelectedIdx = Math.min(favSelectedIdx, engine.favorites.length - 1);
        renderFavorites(engine.favorites, favSelectedIdx, new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
      }
    }
  } else if (key === 'w' || key === 'W') {
    if (engine.favorites.length > 0) {
      engine.toggleDownload(engine.favorites[favSelectedIdx]!);
    }
  } else if (key === 'q' || key === 'Q' || key === '\x1B') {
    returnToPlayer();
  }
}

// ─── Playlist handlers ────────────────────────────────────────────────────

async function onDownloadsKey(key: string) {
  if (key === UP && engine.downloads.length > 0) {
    dlSelectedIdx = Math.max(0, dlSelectedIdx - 1);
    renderDownloads(engine.downloads, dlSelectedIdx, new Set(engine.favorites.map(t => t.id)));
  } else if (key === DOWN && engine.downloads.length > 0) {
    dlSelectedIdx = Math.min(engine.downloads.length - 1, dlSelectedIdx + 1);
    renderDownloads(engine.downloads, dlSelectedIdx, new Set(engine.favorites.map(t => t.id)));
  } else if ((key === '\r' || key === '\n') && engine.downloads.length > 0) {
    await engine.play(engine.downloads[dlSelectedIdx]!);
    currentTrack = engine.currentTrack;
    appState = 'playing';
    startRenderTimer();
    renderPlayerNow();
  } else if (key === 'f' || key === 'F') {
    if (engine.downloads.length > 0) {
      const tr = engine.downloads[dlSelectedIdx]!;
      engine.toggleFavorite(tr);
      renderDownloads(engine.downloads, dlSelectedIdx, new Set(engine.favorites.map(t => t.id)));
    }
  } else if (key === 'd' || key === 'D' || key === 'w' || key === 'W') {
    if (engine.downloads.length > 0) {
      const tr = engine.downloads[dlSelectedIdx]!;
      engine.toggleDownload(tr);
      if (engine.downloads.length === 0) {
        appState = 'search-input';
        goToSearch();
      } else {
        dlSelectedIdx = Math.min(dlSelectedIdx, engine.downloads.length - 1);
        renderDownloads(engine.downloads, dlSelectedIdx, new Set(engine.favorites.map(t => t.id)));
      }
    }
  } else if (key === 'q' || key === 'Q' || key === '\x1B') {
    returnToPlayer();
  }
}

async function onPlaylistListKey(key: string) {
  if (key === UP) {
    plSelectedIdx = Math.max(0, plSelectedIdx - 1);
    renderPlaylistList(engine.playlists, plSelectedIdx, engine.downloads.length, engine.favorites.length);
  } else if (key === DOWN) {
    plSelectedIdx = Math.min(engine.playlists.length + 1, plSelectedIdx + 1);
    renderPlaylistList(engine.playlists, plSelectedIdx, engine.downloads.length, engine.favorites.length);
  } else if (key === '\r' || key === '\n') {
    if (plSelectedIdx === 0) {
      appState = 'downloads';
      dlSelectedIdx = 0;
      renderDownloads(engine.downloads, dlSelectedIdx, new Set(engine.favorites.map(t => t.id)));
    } else if (plSelectedIdx === 1) {
      if (engine.favorites.length > 0) {
        appState = 'favorites';
        favSelectedIdx = 0;
        renderFavorites(engine.favorites, favSelectedIdx, new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
      }
    } else if (engine.playlists.length > 0) {
      currentPlaylist = engine.playlists[plSelectedIdx - 2]!;
      appState = 'playlist-detail';
      plDetailIdx = 0;
      renderPlaylistDetail(currentPlaylist, plDetailIdx, new Set(engine.favorites.map(t => t.id)), new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
    }
  } else if (key === 'c' || key === 'C') {
    prePlaylistState = 'playlist-list';
    appState = 'new-playlist';
    newPlaylistName = '';
    renderNewPlaylistInput(newPlaylistName);
  } else if (key === 'r' || key === 'R') {
    if (plSelectedIdx > 1 && engine.playlists.length > 0) {
      const pl = engine.playlists[plSelectedIdx - 2]!;
      renamingPlaylistId = pl.id;
      renamePlaylistName = pl.name;
      appState = 'rename-playlist';
      renderRenamePlaylistInput(renamePlaylistName);
    }
  } else if (key === 'd' || key === 'D') {
    if (plSelectedIdx > 1 && engine.playlists.length > 0) {
      engine.deletePlaylistById(engine.playlists[plSelectedIdx - 2]!.id);
      plSelectedIdx = Math.min(plSelectedIdx, engine.playlists.length + 1);
      renderPlaylistList(engine.playlists, plSelectedIdx, engine.downloads.length, engine.favorites.length);
    }
  } else if (key === 'w' || key === 'W') {
    if (plSelectedIdx === 1) {
      for (const track of engine.favorites) {
        if (!engine.isDownloaded(track.id) && !engine.isDownloading(track.id)) {
          engine.toggleDownload(track);
        }
      }
    } else if (plSelectedIdx > 1 && engine.playlists.length > 0) {
      const pl = engine.playlists[plSelectedIdx - 2]!;
      for (const track of pl.tracks) {
        if (!engine.isDownloaded(track.id) && !engine.isDownloading(track.id)) {
          engine.toggleDownload(track);
        }
      }
    }
  } else if (key === 'q' || key === 'Q' || key === '\x1B') {
    returnToPlayer();
  }
}

async function onPlaylistDetailKey(key: string) {
  if (!currentPlaylist) return;

  if (key === UP) {
    plDetailIdx = Math.max(0, plDetailIdx - 1);
    renderPlaylistDetail(currentPlaylist, plDetailIdx, new Set(engine.favorites.map(t => t.id)), new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
  } else if (key === DOWN) {
    plDetailIdx = Math.max(0, Math.min(currentPlaylist.tracks.length - 1, plDetailIdx + 1));
    renderPlaylistDetail(currentPlaylist, plDetailIdx, new Set(engine.favorites.map(t => t.id)), new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
  } else if ((key === '\r' || key === '\n') && currentPlaylist.tracks.length > 0) {
    const after = currentPlaylist.tracks.slice(plDetailIdx + 1);
    const before = currentPlaylist.tracks.slice(0, plDetailIdx);
    await engine.playPlaylistTrack(currentPlaylist.tracks[plDetailIdx]!, [...after, ...before]);
    currentTrack = engine.currentTrack;
    appState = 'playing';
    startRenderTimer();
    renderPlayerNow();
  } else if ((key === 'd' || key === 'D') && currentPlaylist.tracks.length > 0) {
    engine.removeTrackFromPlaylist(currentPlaylist.id, plDetailIdx);
    plDetailIdx = Math.max(0, Math.min(plDetailIdx, currentPlaylist.tracks.length - 1));
    renderPlaylistDetail(currentPlaylist, plDetailIdx, new Set(engine.favorites.map(t => t.id)), new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
  } else if (key === 'f' || key === 'F') {
    if (currentPlaylist.tracks.length > 0) {
      const tr = currentPlaylist.tracks[plDetailIdx]!;
      engine.toggleFavorite(tr);
      renderPlaylistDetail(currentPlaylist, plDetailIdx, new Set(engine.favorites.map(t => t.id)), new Set(engine.downloads.map(t => t.id)), engine.downloadingTracks);
    }
  } else if (key === 'w' || key === 'W') {
    if (currentPlaylist.tracks.length > 0) {
      engine.toggleDownload(currentPlaylist.tracks[plDetailIdx]!);
    }
  } else if (key === 'q' || key === 'Q' || key === '\x1B') {
    appState = 'playlist-list';
    renderPlaylistList(engine.playlists, plSelectedIdx, engine.downloads.length, engine.favorites.length);
  }
}

async function onPlaylistPickerKey(key: string) {
  if (key === UP) {
    plPickerIdx = Math.max(0, plPickerIdx - 1);
    renderPlaylistPicker(engine.playlists, plPickerIdx, currentTrack?.title || '');
  } else if (key === DOWN) {
    plPickerIdx = Math.max(0, Math.min(engine.playlists.length - 1, plPickerIdx + 1));
    renderPlaylistPicker(engine.playlists, plPickerIdx, currentTrack?.title || '');
  } else if ((key === '\r' || key === '\n') && engine.playlists.length > 0 && currentTrack) {
    engine.addTrackToPlaylist(engine.playlists[plPickerIdx]!.id, currentTrack);
    returnToPlayer();
  } else if (key === 'c' || key === 'C') {
    prePlaylistState = 'playlist-picker';
    appState = 'new-playlist';
    newPlaylistName = '';
    renderNewPlaylistInput(newPlaylistName);
  } else if (key === 'q' || key === 'Q' || key === '\x1B') {
    returnToPlayer();
  }
}

function onNewPlaylistKey(key: string) {
  if (key === '\x1B') {
    // Esc - go back
    if (prePlaylistState === 'playlist-picker') {
      appState = 'playlist-picker';
      renderPlaylistPicker(engine.playlists, plPickerIdx, currentTrack?.title || '');
    } else {
      appState = 'playlist-list';
      renderPlaylistList(engine.playlists, plSelectedIdx, engine.downloads.length, engine.favorites.length);
    }
  } else if (key === '\r' || key === '\n') {
    if (!newPlaylistName.trim()) return;
    engine.createPlaylist(newPlaylistName.trim());
    if (prePlaylistState === 'playlist-picker') {
      plPickerIdx = engine.playlists.length - 1;
      appState = 'playlist-picker';
      renderPlaylistPicker(engine.playlists, plPickerIdx, currentTrack?.title || '');
    } else {
      plSelectedIdx = engine.playlists.length + 1;
      appState = 'playlist-list';
      renderPlaylistList(engine.playlists, plSelectedIdx, engine.downloads.length, engine.favorites.length);
    }
  } else if (key === '\x7F' || key === '\b') {
    newPlaylistName = newPlaylistName.slice(0, -1);
    renderNewPlaylistInput(newPlaylistName);
  } else if (key.length === 1 && key >= ' ') {
    newPlaylistName += key;
    renderNewPlaylistInput(newPlaylistName);
  }
}

function onRenamePlaylistKey(key: string) {
  if (key === '\x1B') {
    appState = 'playlist-list';
    renderPlaylistList(engine.playlists, plSelectedIdx, engine.downloads.length, engine.favorites.length);
  } else if (key === '\r' || key === '\n') {
    if (!renamePlaylistName.trim()) return;
    engine.renamePlaylistById(renamingPlaylistId, renamePlaylistName.trim());
    appState = 'playlist-list';
    renderPlaylistList(engine.playlists, plSelectedIdx, engine.downloads.length, engine.favorites.length);
  } else if (key === '\x7F' || key === '\b') {
    renamePlaylistName = renamePlaylistName.slice(0, -1);
    renderRenamePlaylistInput(renamePlaylistName);
  } else if (key.length === 1 && key >= ' ') {
    renamePlaylistName += key;
    renderRenamePlaylistInput(renamePlaylistName);
  }
}

function onLanguagePickerKey(key: string) {
  if (key === UP) {
    langPickerIdx = Math.max(0, langPickerIdx - 1);
    renderLanguagePicker(LANGS, langPickerIdx);
  } else if (key === DOWN) {
    langPickerIdx = Math.min(LANGS.length - 1, langPickerIdx + 1);
    renderLanguagePicker(LANGS, langPickerIdx);
  } else if (key === '\r' || key === '\n') {
    const next = LANGS[langPickerIdx]!;
    setLang(next as any);
    engine.saveSettings({ lang: next as any });

    appState = preLanguageState;
    if (appState === 'playing' && currentTrack) {
        startRenderTimer();
    }
    renderCurrentScreen();
  } else if (key === '\x1B' || key === 'q' || key === 'Q') {
    appState = preLanguageState;
    if (appState === 'playing' && currentTrack) {
        startRenderTimer();
    }
    renderCurrentScreen();
  }
}

// ─── Cleanup & init ───────────────────────────────────────────────────────

let isCleaningUp = false;
async function cleanup() {
  if (isCleaningUp) return;
  isCleaningUp = true;
  if (renderTimer) clearInterval(renderTimer);
  if (terminalStarted && process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(false);
    process.stdin.off('data', handleKey);
    process.stdin.pause();
  }
  if (terminalStarted && process.stdout.isTTY) clearScreen();
  try { await controlServer?.stop(); } catch {}
  controlServer = null;
  if (playerStarted) await engine.quit();
  if (terminalStarted && process.stdout.isTTY) process.stdout.write(chalk_reset());
}

function chalk_reset() { return '\x1B[0m\n'; }

function printControlResponse(response: ControlResponse) {
  const stream = response.ok ? process.stdout : process.stderr;
  stream.write(`${response.message}\n`);
  if (!response.ok) process.exitCode = 1;
}

async function runInteractive(initialQuery: string | null) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Starting MELO requires an interactive terminal.');
  }

  await ensureRuntimeDependencies();

  const settings = engine.loadSettings();
  setLang((settings.lang as Lang) || 'en');

  await engine.start();
  playerStarted = true;

  controlServer = new ControlServer(handleControlCommand);
  await controlServer.start();

  // Forward engine events to control socket subscribers
  const forwardEvent = (event: any) => {
    if (event && typeof event === 'object' && 'type' in event) {
      controlServer?.broadcast(event);
    }
  };    engine.on('track-changed', forwardEvent);
    engine.on('playback-state', forwardEvent);
    engine.on('queue-changed', forwardEvent);
    engine.on('queue-refilled', forwardEvent);
    engine.on('volume-changed', forwardEvent);
    engine.on('shuffle-changed', forwardEvent);
    engine.on('repeat-changed', forwardEvent);
    engine.on('favorites-changed', forwardEvent);

  process.stdin.setRawMode(true);
  terminalStarted = true;
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', handleKey);

  const handleExit = async () => {
    await cleanup();
    process.exit(0);
  };

  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);
  process.on('SIGHUP', handleExit);
  process.on('SIGUSR2', handleExit);

  process.on('uncaughtException', async (err) => {
    await cleanup();
    console.error('Uncaught Exception:', err);
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    await cleanup();
    console.error('Unhandled Rejection:', reason);
    process.exit(1);
  });

  if (initialQuery) {
    searchQuery = initialQuery;
    renderSearch(t('searching'), `"${initialQuery}"`, searchMode);

    try {
      const [firstResult] = await engine.searchTracks(initialQuery, 1);
      if (!firstResult) {
        searchQuery = '';
        renderSearch('', t('noResults'), searchMode);
        return;
      }
      await engine.play(firstResult);
      currentTrack = engine.currentTrack;
    } catch {
      searchQuery = '';
      renderSearch('', t('ytdlpError'), searchMode);
    }
    return;
  }

  goToSearch();
}

async function main() {
  if (cliCommand.action === 'control') {
    try {
      const response = await sendControlCommand(cliCommand.command);
      printControlResponse(response);
      return;
    } catch (error) {
      if (!(error instanceof ControlUnavailableError)) throw error;

      if (cliCommand.command.type === 'play') {
        await runInteractive(cliCommand.command.query);
        return;
      }

      process.stderr.write('melo: no player is running. Start one with `melo` or `melo play <song name>`.\n');
      process.exitCode = 1;
      return;
    }
  }

  try {
    await sendControlCommand({ type: 'status' }, { timeout: 1000 });
    process.stderr.write('melo: another player is already running. Use `melo status` or another control command.\n');
    process.exitCode = 1;
    return;
  } catch (error) {
    if (!(error instanceof ControlUnavailableError)) throw error;
  }

  await runInteractive(null);
}

main().catch(async (e) => {
  if (playerStarted || terminalStarted || controlServer) await cleanup();
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`melo: ${message}\n`);
  process.exitCode = 1;
});
