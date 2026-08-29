import { useState, useEffect, useCallback } from 'react';
import { useBackend } from './hooks/useBackend';
import { ChromeBar } from './components/ChromeBar';
import { ConnectionBanner } from './components/ConnectionBanner';
import { ArtworkStage } from './components/ArtworkStage';
import { DiscoverStage } from './components/DiscoverStage';
import { SearchOverlay } from './components/SearchOverlay';
import { QueuePanel } from './components/QueuePanel';
import { LibraryPanel } from './components/LibraryPanel';

// ─── Theme ───────────────────────────────────────────────────────────────────

type Theme = 'light' | 'dark' | 'system';

function resolveTheme(t: Theme): 'light' | 'dark' {
  if (t === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return t;
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', resolveTheme(t));
}

// ─── Panel state ─────────────────────────────────────────────────────────────

type Panel = 'queue' | 'library' | null;

// ─── App ─────────────────────────────────────────────────────────────────────

export function App() {
  const b = useBackend();

  // Theme
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('ym-theme') as Theme) || 'light'
  );

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem('ym-theme', theme);
  }, [theme]);

  // System theme listener
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

  // Active panel (right-side contextual)
  const [panel, setPanel] = useState<Panel>(null);

  const togglePanel = useCallback((which: NonNullable<Panel>) => {
    setPanel(p => p === which ? null : which);
  }, []);

  const closePanel = useCallback(() => setPanel(null), []);

  // Search overlay
  const [searchOpen, setSearchOpen] = useState(false);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // Keyboard shortcut: Ctrl+F / Cmd+F → open search
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

  // Collapse panel overlay click
  const handleOverlayClick = useCallback(() => {
    setPanel(null);
  }, []);

  const { state } = b;

  return (
    <div className="app">
      {/* Connection status banner (only visible when not connected) */}
      <ConnectionBanner state={state.connectionState} />

      {/* Chrome Bar */}
      <ChromeBar
        theme={theme}
        connectionState={state.connectionState}
        queueOpen={panel === 'queue'}
        libraryOpen={panel === 'library'}
        onSearch={openSearch}
        onToggleQueue={() => togglePanel('queue')}
        onToggleLibrary={() => togglePanel('library')}
        onCycleTheme={cycleTheme}
        onRetry={b.retryBackend}
      />

      {/* Main Stage */}
      <div className={`stage${panel !== null ? ' panel-open' : ''}`}>
        {/* Ambient bg + primary content */}
        {state.currentTrack ? (
          <ArtworkStage
            state={state}
            onTogglePause={b.togglePause}
            onNext={b.nextTrack}
            onPrevious={b.previousTrack}
            onSeekTo={b.seekTo}
            onSetVolume={b.setVolume}
            onToggleMute={b.toggleMute}
            onToggleShuffle={b.toggleShuffle}
            onCycleRepeat={b.cycleRepeat}
            onOpenQueue={() => togglePanel('queue')}
          />
        ) : (
          <DiscoverStage
            state={state}
            onOpenSearch={openSearch}
            onPlay={b.play}
          />
        )}

        {/* Panel overlay (click to close) */}
        <div
          className={`panel-overlay${panel !== null ? ' visible' : ''}`}
          onClick={handleOverlayClick}
          aria-hidden="true"
        />

        {/* Queue Panel */}
        <QueuePanel
          open={panel === 'queue'}
          state={state}
          onClose={closePanel}
          onPlay={b.play}
          onClear={b.clearQueue}
          onRemove={b.removeFromQueue}
        />

        {/* Library Panel */}
        <LibraryPanel
          open={panel === 'library'}
          state={state}
          onClose={closePanel}
          onPlay={b.play}
          onOpenSearch={openSearch}
        />
      </div>

      {/* Search Overlay (fullscreen, rendered on top of everything) */}
      {searchOpen && (
        <SearchOverlay
          results={state.searchResults}
          searching={state.searching}
          currentTrack={state.currentTrack}
          loadingTrack={state.loadingTrack}
          onSearch={b.search}
          onPlay={b.play}
          onAddToQueue={b.addToQueue}
          onPlayNext={b.playNext}
          onClose={closeSearch}
        />
      )}

      {/* Error toast */}
      {state.error && (
        <div className="toast error" role="alert" aria-live="assertive">
          {state.error}
        </div>
      )}
    </div>
  );
}
