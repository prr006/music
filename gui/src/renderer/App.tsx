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
import { SettingsPopover } from './components/SettingsPopover';
import { artworkFor } from './lib/media';
import { readStoredTheme, writeStoredTheme } from './lib/theme-storage';
import { readSidebarExpanded, writeSidebarExpanded } from './lib/sidebar-storage';

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

export function App() {
  const b = useBackend();
  const { state } = b;

  const [theme, setTheme] = useState<Theme>(() => readStoredTheme(localStorage));
  const [view, setView] = useState<View>('home');
  const [searchOpen, setSearchOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
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

  const cycleTheme = useCallback(() => {
    setTheme(t => t === 'light' ? 'dark' : t === 'dark' ? 'system' : 'light');
  }, []);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const track = state.currentTrack;
  const showMini = view !== 'home' && !!track;
  const ambient = track ? artworkFor(track, true) : '';

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
                    onToggleQueue={() => setQueueOpen(o => !o)}
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
            state={state}
            onClose={() => setQueueOpen(false)}
            onPlay={b.play}
            onClear={b.clearQueue}
            onRemove={b.removeFromQueue}
          />

          {settingsOpen && (
            <SettingsPopover
              theme={theme}
              connectionState={state.connectionState}
              onTheme={setTheme}
              onRetry={b.retryBackend}
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
          onSearch={b.search}
          onPlay={b.play}
          onAddToQueue={b.addToQueue}
          onPlayNext={b.playNext}
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
