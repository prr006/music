import { Search, Home, Disc3, Radio, Heart, Settings } from 'lucide-react';
import type { View } from '../types';

interface SidebarProps {
  view: View;
  onNavigate: (view: View) => void;
  onSearch: () => void;
  onSettings: () => void;
  settingsOpen: boolean;
}

function LogoMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 18V6l11-2v12" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="18" r="3" fill="white" />
      <circle cx="18" cy="16" r="3" fill="white" />
    </svg>
  );
}

export function Sidebar({ view, onNavigate, onSearch, onSettings, settingsOpen }: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="Main">
      <button
        className="sidebar-logo"
        onClick={() => onNavigate('home')}
        title="MELO"
        aria-label="Home"
      >
        <LogoMark />
      </button>

      <div className="sidebar-group">
        <button
          className="sidebar-btn"
          onClick={onSearch}
          title="Search (Ctrl+F)"
          aria-label="Search"
          id="sidebar-search"
        >
          <Search size={18} strokeWidth={1.7} />
        </button>
        <button
          className={`sidebar-btn${view === 'home' ? ' active' : ''}`}
          onClick={() => onNavigate('home')}
          title="Home"
          aria-label="Home"
          aria-current={view === 'home' ? 'page' : undefined}
          id="sidebar-home"
        >
          <Home size={18} strokeWidth={1.7} />
        </button>
        <button
          className={`sidebar-btn${view === 'library' ? ' active' : ''}`}
          onClick={() => onNavigate('library')}
          title="Library"
          aria-label="Library"
          aria-current={view === 'library' ? 'page' : undefined}
          id="sidebar-library"
        >
          <Disc3 size={18} strokeWidth={1.7} />
        </button>
        <button
          className={`sidebar-btn${view === 'radio' ? ' active' : ''}`}
          onClick={() => onNavigate('radio')}
          title="Radio mix"
          aria-label="Radio mix"
          aria-current={view === 'radio' ? 'page' : undefined}
          id="sidebar-radio"
        >
          <Radio size={18} strokeWidth={1.7} />
        </button>
        <button
          className={`sidebar-btn${view === 'favorites' ? ' active' : ''}`}
          onClick={() => onNavigate('favorites')}
          title="Favorites"
          aria-label="Favorites"
          aria-current={view === 'favorites' ? 'page' : undefined}
          id="sidebar-favorites"
        >
          <Heart size={18} strokeWidth={1.7} />
        </button>
      </div>

      <div className="sidebar-foot">
        <button
          className={`sidebar-btn${settingsOpen ? ' active' : ''}`}
          onClick={onSettings}
          title="Settings"
          aria-label="Settings"
          aria-pressed={settingsOpen}
          id="sidebar-settings"
        >
          <Settings size={18} strokeWidth={1.7} />
        </button>
      </div>
    </nav>
  );
}
