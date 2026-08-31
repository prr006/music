import { useState, useEffect, useCallback, useRef } from 'react';
import { useBackend } from './hooks/useBackend';
import type { Theme, View } from './types';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { ConnectionBanner } from './components/ConnectionBanner';
import { ArtworkStage } from './components/ArtworkStage';
import { NowPlayingPanel } from './components/NowPlayingPanel';
import { DiscoverStage } from './components/DiscoverStage';
import { LibraryView } from './components/LibraryView';
import { FavoritesView } from './components/FavoritesView';
import { RadioView } from './components/RadioView';
import { SearchOverlay } from './components/SearchOverlay';
import { QueuePanel } from './components/QueuePanel';
import { MiniPlayer } from './components/MiniPlayer';
import { CompactMini } from './components/CompactMini';
import { SettingsPopover } from './components/SettingsPopover';
import { artworkFor } from './lib/media';
import { readStoredTheme, writeStoredTheme } from './lib/theme-storage';
import { readSidebarExpanded, writeSidebarExpanded } from './lib/sidebar-storage';
import { isSpaceReservedTarget, isTypingTarget, matchShortcut } from './lib/hotkeys';
import { syncMediaSession } from './lib/media-session';

function AmbientBackdrop({ src }: { src: string }) {
  const [shown, setShown] = useState(src);
  const [on, setOn] = useState(!!src);
  const gen = useRef(0);

  useEffect(() => {
    if (!src) {
      gen.current += 1;
      setOn(false);
      return;
    }
    const token = ++gen.current;
    setOn(false);
    const img = new Image();
    img.onload = () => {
      if (token !== gen.current) return;
      setShown(src);
      requestAnimationFrame(() => {
        if (token !== gen.current) return;
        setOn(true);
      });
    };
    img.src = src;
  }, [src]);

  if (!shown) return null;
  return (
    <div className="ambient" aria-hidden="true">
      <img src={shown} alt="" className={`ambient-img${on ? ' visible' : ''}`} />
      <div className="ambient-vignette" />
    </div>
  );
}

function resolveTheme(t: Theme): 'light' | 'dark' {
  if (t === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return t;
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', resolveTheme(t));
}

function isMiniWindow() {
  return typeof window !== 'undefined' && window.location.hash === '#mini';
}

export function App() {
  const b = useBackend();
  const { state } = b;
  const miniWindow = isMiniWindow();

  const [theme, setTheme] = useState<Theme>(() => readStoredTheme(localStorage));
  const [view, setView] = useState<View>('home');
  const [searchOpen, setSearchOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [rightTab, setRightTab] = useState<'queue' | 'lyrics'>('queue');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(() => readSidebarExpanded(localStorage));

  useEffect(() => {
    applyTheme(theme);
    writeStoredTheme(theme, localStorage);
  }, [theme]);

  useEffect(() => {
    writeSidebarExpanded(sidebarExpanded, localStorage);
  }, [sidebarExpanded]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = () => applyTheme('system');
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [theme]);

  useEffect(() => {
    void window.api.setCloseBehavior?.(state.settings.closeBehavior);
  }, [state.settings.closeBehavior]);

  useEffect(() => {
    void window.api.setMinimizeToTray?.(state.settings.minimizeToTray);
  }, [state.settings.minimizeToTray]);

  useEffect(() => {
    void window.api.setMiniAlwaysOnTop?.(state.settings.miniAlwaysOnTop);
  }, [state.settings.miniAlwaysOnTop]);

  const didStartMin = useRef(false);
  useEffect(() => {
    if (didStartMin.current || !state.settings.startMinimized) return;
    didStartMin.current = true;
    window.api.windowMinimize?.();
  }, [state.settings.startMinimized]);

  const cycleTheme = useCallback(() => {
    setTheme(t => t === 'light' ? 'dark' : t === 'dark' ? 'system' : 'light');
  }, []);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  const toggleQueue = useCallback(() => {
    setRightTab('queue');
    setQueueOpen(open => !open);
  }, []);

  const toggleLyrics = useCallback(() => {
    if (queueOpen && rightTab === 'lyrics') {
      setQueueOpen(false);
    } else {
      setRightTab('lyrics');
      setQueueOpen(true);
    }
  }, [queueOpen, rightTab]);

  useEffect(() => {
    if (!queueOpen || rightTab !== 'lyrics' || !state.currentTrack) return;
    void b.fetchLyrics(state.currentTrack);
  }, [queueOpen, rightTab, state.currentTrack?.id]);

  useEffect(() => {
    return syncMediaSession(state.currentTrack, state.playing, {
      play: () => { if (!state.playing) void b.togglePause(); },
      pause: () => { if (state.playing) void b.togglePause(); },
      next: () => { void b.nextTrack(); },
      previous: () => { void b.previousTrack(); },
      seek: seconds => { void b.seek(seconds); },
    });
  }, [state.currentTrack, state.playing, b.togglePause, b.nextTrack, b.previousTrack, b.seek]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (isTypingTarget(e.target) || searchOpen) return;
      const action = matchShortcut(e);
      if (!action) return;
      if (action === 'toggle' && isSpaceReservedTarget(e.target)) return;
      e.preventDefault();
      switch (action) {
        case 'toggle': void b.togglePause(); break;
        case 'seekBack': void b.seek(-10); break;
        case 'seekForward': void b.seek(10); break;
        case 'previous': void b.previousTrack(); break;
        case 'next': void b.nextTrack(); break;
        case 'volumeUp': void b.adjustVolume(5); break;
        case 'volumeDown': void b.adjustVolume(-5); break;
        case 'mute': void b.toggleMute(); break;
        case 'search': setSearchOpen(true); break;
        case 'queue': toggleQueue(); break;
        case 'favorite': void b.toggleFavorite(); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [b, searchOpen, toggleQueue]);

  const track = state.currentTrack;
  const showMini = view !== 'home' && !!track;
  const ambient = track ? artworkFor(track, true) : '';

  if (miniWindow) {
    return (
      <CompactMini
        state={state}
        onTogglePause={b.togglePause}
        onNext={b.nextTrack}
        onPrevious={b.previousTrack}
        onFavorite={() => void b.toggleFavorite()}
        onShowMain={() => window.api.showMainWindow?.()}
      />
    );
  }

  return (
    <div className={`app${showMini ? ' has-mini' : ''}${sidebarExpanded ? ' sidebar-expanded' : ''}`}>
      <TitleBar />
      <ConnectionBanner state={state.connectionState} />

      <div className="shell">
        <Sidebar
          view={view}
          expanded={sidebarExpanded}
          onToggleExpanded={() => setSidebarExpanded(v => !v)}
          onNavigate={(v) => { setView(v); setSettingsOpen(false); }}
          onSearch={openSearch}
          onSettings={() => setSettingsOpen(s => !s)}
          settingsOpen={settingsOpen}
        />

        <div className={`workspace${view === 'home' ? ' is-home' : ''}${queueOpen ? ' queue-open' : ''}`}>
          <div className="workspace-main">
          {view === 'home' ? (
            <div className="home-layout">
              <div className="player-stage">
                <AmbientBackdrop src={ambient} />
                <div className="player-body">
                  {track ? (
                    <ArtworkStage
                      track={track}
                      playing={state.playing}
                      loading={state.loading}
                      onTogglePause={b.togglePause}
                    />
                  ) : (
                    <DiscoverStage
                      state={state}
                      onOpenSearch={openSearch}
                      onPlay={b.play}
                    />
                  )}
                  <NowPlayingPanel
                    state={state}
                    theme={theme}
                    queueOpen={queueOpen}
                    lyricsOpen={queueOpen && rightTab === 'lyrics'}
                    onTogglePause={b.togglePause}
                    onNext={b.nextTrack}
                    onPrevious={b.previousTrack}
                    onSeekTo={b.seekTo}
                    onSetVolume={b.setVolume}
                    onToggleMute={b.toggleMute}
                    onToggleShuffle={b.toggleShuffle}
                    onCycleRepeat={b.cycleRepeat}
                    onToggleFavorite={b.toggleFavorite}
                    onAddToQueue={b.addToQueue}
                    onToggleQueue={toggleQueue}
                    onToggleLyrics={toggleLyrics}
                    onCycleTheme={cycleTheme}
                  />
                </div>
              </div>
            </div>
          ) : view === 'library' ? (
            <LibraryView
              state={state}
              onPlay={b.play}
              onToggleFavorite={b.toggleFavorite}
              onOpenSearch={openSearch}
              onCreatePlaylist={name => void b.createPlaylist(name)}
              onDeletePlaylist={id => void b.deletePlaylist(id)}
              onRenamePlaylist={(id, name) => void b.renamePlaylist(id, name)}
              onPlayPlaylist={(id, index) => void b.playPlaylist(id, index)}
              onRemoveFromPlaylist={(id, index) => void b.removeFromPlaylist(id, index)}
              onReorderPlaylist={(id, from, to) => void b.reorderPlaylist(id, from, to)}
              onAddToQueue={b.addToQueue}
              onPlayNext={b.playNext}
              onClearHistory={() => void b.clearHistory()}
            />
          ) : view === 'favorites' ? (
            <FavoritesView
              state={state}
              onPlay={b.play}
              onToggleFavorite={b.toggleFavorite}
              onOpenSearch={openSearch}
            />
          ) : (
            <RadioView
              state={state}
              onPlay={b.play}
              onOpenSearch={openSearch}
            />
          )}
          </div>

          {queueOpen && (
            <div className="drawer-scrim" onClick={() => setQueueOpen(false)} />
          )}
          <QueuePanel
            open={queueOpen}
            tab={rightTab}
            onTab={setRightTab}
            state={state}
            onClose={() => setQueueOpen(false)}
            onPlayIndex={b.playFromQueue}
            onClear={b.clearQueue}
            onRemove={b.removeFromQueue}
            onMove={b.moveQueue}
            onSavePlaylist={name => void b.saveQueueAsPlaylist(name)}
            onPlayNext={b.playNext}
          />

          {settingsOpen && (
            <SettingsPopover
              theme={theme}
              connectionState={state.connectionState}
              settings={state.settings}
              onTheme={setTheme}
              onSettings={patch => void b.saveSettings(patch)}
              onRetry={b.retryBackend}
              onToggleMini={() => void window.api.toggleMiniPlayer?.()}
            />
          )}
        </div>
      </div>

      {showMini && (
        <MiniPlayer
          state={state}
          onTogglePause={b.togglePause}
          onNext={b.nextTrack}
          onPrevious={b.previousTrack}
          onSeekTo={b.seekTo}
          onOpenHome={() => setView('home')}
        />
      )}

      {searchOpen && (
        <SearchOverlay
          results={state.searchResults}
          searching={state.searching}
          currentTrack={state.currentTrack}
          loadingTrack={state.loadingTrack}
          recent={state.history}
          playlists={state.playlists}
          onSearch={b.search}
          onPlay={b.play}
          onAddToQueue={b.addToQueue}
          onPlayNext={b.playNext}
          onPlayPlaylist={id => void b.playPlaylist(id)}
          onClose={closeSearch}
        />
      )}

      {state.error && (
        <div className="toast error" role="alert" aria-live="assertive">
          {state.error}
        </div>
      )}
    </div>
  );
}
