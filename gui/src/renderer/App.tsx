import { useState, useEffect, useCallback, useRef } from 'react';
import { useBackend } from './hooks/useBackend';
import { TopBar } from './components/TopBar';
import { NowPlayingView } from './components/NowPlayingView';
import { SearchView } from './components/SearchView';
import { LibraryDrawer } from './components/LibraryDrawer';
import { QueueDrawer } from './components/QueueDrawer';
import { ConnectionBanner } from './components/ConnectionBanner';

type View = 'home' | 'search' | 'now-playing' | 'library' | 'queue';
type Theme = 'light' | 'dark' | 'system';
type PlayerExpansion = 'compact' | 'expanded';

function systemTheme(): 'light' | 'dark' {
  const win: any = typeof window !== 'undefined' ? window : {};
  const mq = win.matchMedia ? win.matchMedia('(prefers-color-scheme: dark)') : { matches: false };
  return mq.matches ? 'dark' : 'light';
}
function applyTheme(t: Theme) {
  const doc: any = typeof document !== 'undefined' ? document : {};
  if (doc.documentElement) {
    doc.documentElement.setAttribute('data-theme', t === 'system' ? systemTheme() : t);
  }
}

export function App() {
  const b = useBackend();
  const [view, setView] = useState<View>('home');
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('ym-theme') as Theme) || 'light');
  const [playerExpansion, setPlayerExpansion] = useState<PlayerExpansion>('compact');

  useEffect(() => { applyTheme(theme); localStorage.setItem('ym-theme', theme); }, [theme]);

  useEffect(() => {
    if (theme === 'system') {
      const win: any = typeof window !== 'undefined' ? window : {};
      const mq = win.matchMedia('(prefers-color-scheme: dark)');
      const h = () => applyTheme('system');
      mq.addEventListener('change', h);
      return () => mq.removeEventListener('change', h);
    }
  }, [theme]);

  const cycleTheme = useCallback(() => setTheme(t => t === 'light' ? 'dark' : t === 'dark' ? 'system' : 'light'), []);

  const togglePlayerExpansion = useCallback(() => setPlayerExpansion(p => p === 'compact' ? 'expanded' : 'compact'), []);

  // Initialize player expansion based on connection state
  useEffect(() => {
    const state = b.state;
    if (state && state.connectionState === 'connected') {
      if (playerExpansion === 'expanded' && !state.currentTrack) {
        setPlayerExpansion('compact');
      }
    } else {
      setPlayerExpansion('compact');
    }
  }, [playerExpansion, b]);

  // Sync player expansion from backend track changes via the API event system
  useEffect(() => {
    const unsub = (typeof window !== 'undefined' ? window.api : { onEvent: () => {} }).onEvent((event: any) => {
      if (event.type === 'track-changed' && event.track) {
        if (!event.track && playerExpansion === 'expanded') {
          setPlayerExpansion('compact');
        }
      }
      if (event.type === 'playback-state') {
        // Position/duration/volume updates happen via state sync
      }
    });
    return () => unsub?.();
  }, [playerExpansion]);

  return (
    <>
      <ConnectionBanner state={b.state.connectionState} onRetry={b.retryBackend} />
      {b.state.error && <div className="toast error">{b.state.error}</div>}

      {/* Top Application Bar — compact, always visible navigation */}
      <TopBar
        theme={theme}
        onTheme={cycleTheme}
        onSearch={() => setView('search')}
        onLibrary={() => setView('library')}
        onNowPlaying={() => setView('now-playing')}
      />

      {/* Main Content Area — adapts based on view and playback state */}
      <div style={{ marginTop: 56, minHeight: 'calc(100vh - 56px)' }}>
        {/* Now Playing — immersive artwork-centric view when music is playing */}
        {view === 'now-playing' && <NowPlayingView expansion={playerExpansion} state={b.state} onPlay={b.play} onPrevious={b.previousTrack} onNext={b.nextTrack} onSeek={b.seek} onSetVolume={b.setVolume} onToggleMute={b.toggleMute} onToggleShuffle={b.toggleShuffle} onCycleRepeat={b.cycleRepeat} onTogglePlayerExpansion={togglePlayerExpansion} />}

        {/* Search — premium search experience */}
        {view === 'search' && <SearchView state={b.state} onClose={() => setView('home')} onPlay={b.play} onAddToQueue={b.addToQueue} onPlayNext={b.playNext} />}

        {/* Library — contextual panel/navigation */}
        {view === 'library' && <LibraryDrawer state={b.state} onClose={() => setView('home')} />}

        {/* Queue — expandable drawer */}
        {view === 'queue' && <QueueDrawer state={b.state} onClear={b.clearQueue} onPlay={b.play} />}

        {/* Home / Browse — editorial main screen (default, shown when nothing playing and no other view active) */}
        {view === 'home' && !b.state.currentTrack && <HomeView state={b.state} onPlay={b.play} onNavigate={() => setView('search')} />}

        {/* Home with playback — shown when track is playing and home view is active */}
        {view === 'home' && b.state.currentTrack && <NowPlayingView expansion={playerExpansion} state={b.state} onPlay={b.play} onPrevious={b.previousTrack} onNext={b.nextTrack} onSeek={b.seek} onSetVolume={b.setVolume} onToggleMute={b.toggleMute} onToggleShuffle={b.toggleShuffle} onCycleRepeat={b.cycleRepeat} onTogglePlayerExpansion={togglePlayerExpansion} />}
      </div>
    </>
  );
}