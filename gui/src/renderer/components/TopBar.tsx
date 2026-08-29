import React from 'react';

type Theme = 'light' | 'dark' | 'system';

interface TopBarProps {
  theme: Theme;
  onTheme: () => void;
  onSearch: () => void;
  onLibrary: () => void;
  onNowPlaying: () => void;
}

export function TopBar({ theme, onTheme, onSearch, onLibrary, onNowPlaying }: TopBarProps) {
  return (
    <div className="topbar">
      {/* Brand / App name */}
      <div className="brand">
        <div className="brand-mark">Y</div>
        <span className="brand-text">YTMusic</span>
      </div>

      {/* Navigation tabs */}
      <div className="nav">
        <button className="nav-item active" onClick={onSearch}>Search</button>
        <button className="nav-item" onClick={onLibrary}>Library</button>
        <button className="nav-item" onClick={onNowPlaying}>Now Playing</button>
      </div>

      {/* Search field */}
      <div className="search-wrap">
        <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <input ref={null} type="text" className="search-input" placeholder="Search for songs, artists, or albums" />
      </div>

      {/* Controls & connection */}
      <div className="controls">
        <button className="control-btn" title="Shuffle" onClick={(e) => { e.stopPropagation(); onTheme(); }}>
          {/* Shuffle icon would be injected or use CSS */}
        </button>
        <button className="control-btn" title="Repeat" onClick={(e) => { e.stopPropagation(); }}>↺</button>
        <div className="conn-indicator" id="conn-status">Connecting…</div>
      </div>
    </div>
  );
}