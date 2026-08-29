import { Home, Search, ListMusic, Disc3, Sun, Moon, Monitor } from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';

interface Props {
  view: string;
  onChange: (v: 'home' | 'search' | 'now-playing' | 'queue') => void;
  state: PlayerState;
  theme: string;
  onTheme: () => void;
}

function thumb(id: string) { return `https://img.youtube.com/vi/${id}/mqdefault.jpg`; }

export function Sidebar({ view, onChange, state, theme, onTheme }: Props) {
  return (
    <div className="nav">
      <div className="nav-brand">
        <div className="nav-brand-mark"><Disc3 size={16} strokeWidth={2.5} /></div>
        <span className="nav-brand-text">YTMusic</span>
      </div>

      <div className="nav-links">
        <div className="nav-section">Browse</div>
        <button className={`nav-item ${view === 'home' ? 'on' : ''}`} onClick={() => onChange('home')}>
          <Home className="nav-item-icon" size={18} /><span>Home</span>
        </button>
        <button className={`nav-item ${view === 'search' ? 'on' : ''}`} onClick={() => onChange('search')}>
          <Search className="nav-item-icon" size={18} /><span>Search</span>
        </button>

        <div className="nav-section">Your Library</div>
        <button className={`nav-item ${view === 'queue' ? 'on' : ''}`} onClick={() => onChange('queue')}>
          <ListMusic className="nav-item-icon" size={18} /><span>Queue</span>
          {state.queue.length > 0 && <span className="nav-badge">{state.queue.length}</span>}
        </button>
        <button className={`nav-item ${view === 'now-playing' ? 'on' : ''}`} onClick={() => onChange('now-playing')}>
          <Disc3 className="nav-item-icon" size={18} /><span>Now Playing</span>
        </button>
      </div>

      <div className="nav-mini" onClick={() => state.currentTrack && onChange('now-playing')}>
        {state.currentTrack ? (
          <>
            <img src={thumb(state.currentTrack.id)} alt="" className="nav-mini-art" />
            <div className="nav-mini-info">
              <div className="nav-mini-title">{state.currentTrack.title || 'Unknown'}</div>
              <div className="nav-mini-artist">{state.loading ? 'Loading...' : (state.currentTrack.uploader || '')}</div>
            </div>
            {state.playing && !state.loading && <div className="nav-mini-eq"><span /><span /><span /></div>}
          </>
        ) : (
          <div style={{ width: '100%', textAlign: 'center', fontSize: 11, color: 'var(--c-text-3)' }}>No track playing</div>
        )}
      </div>

      <div className="nav-theme">
        <button className="nav-theme-btn" onClick={onTheme} title={`Theme: ${theme}`}>
          {theme === 'dark' ? <Moon size={14} /> : theme === 'system' ? <Monitor size={14} /> : <Sun size={14} />}
          <span>{theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
        </button>
      </div>
    </div>
  );
}
