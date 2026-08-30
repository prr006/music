import type { ReactNode } from 'react';
import { Search, Home, Disc3, Radio, Heart, Settings, PanelLeft, PanelLeftClose } from 'lucide-react';
import type { View } from '../types';

interface SidebarProps {
  view: View;
  expanded: boolean;
  onToggleExpanded: () => void;
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

function NavButton({
  id,
  label,
  tip,
  active,
  expanded,
  onClick,
  children,
  pressed,
}: {
  id: string;
  label: string;
  tip?: string;
  active?: boolean;
  expanded: boolean;
  onClick: () => void;
  children: React.ReactNode;
  pressed?: boolean;
}) {
  return (
    <button
      className={`sidebar-btn tip${active ? ' active' : ''}`}
      onClick={onClick}
      data-tip={expanded ? undefined : (tip ?? label)}
      aria-label={label}
      aria-current={pressed === undefined && active ? 'page' : undefined}
      aria-pressed={pressed}
      id={id}
    >
      {children}
      <span className="sidebar-label">{label}</span>
    </button>
  );
}

export function Sidebar({
  view, expanded, onToggleExpanded, onNavigate, onSearch, onSettings, settingsOpen,
}: SidebarProps) {
  return (
    <nav className={`sidebar${expanded ? ' expanded' : ''}`} aria-label="Main">
      <button
        className="sidebar-logo tip"
        onClick={() => onNavigate('home')}
        data-tip={expanded ? undefined : 'Home'}
        aria-label="Home"
      >
        <LogoMark />
        <span className="sidebar-brand">MELO</span>
      </button>

      <div className="sidebar-group">
        <NavButton id="sidebar-search" label="Search" tip="Search (Ctrl+F)" expanded={expanded} onClick={onSearch}>
          <Search size={18} strokeWidth={1.7} />
        </NavButton>
        <NavButton id="sidebar-home" label="Home" active={view === 'home'} expanded={expanded} onClick={() => onNavigate('home')}>
          <Home size={18} strokeWidth={1.7} />
        </NavButton>
        <NavButton id="sidebar-library" label="Library" active={view === 'library'} expanded={expanded} onClick={() => onNavigate('library')}>
          <Disc3 size={18} strokeWidth={1.7} />
        </NavButton>
        <NavButton id="sidebar-radio" label="Radio mix" active={view === 'radio'} expanded={expanded} onClick={() => onNavigate('radio')}>
          <Radio size={18} strokeWidth={1.7} />
        </NavButton>
        <NavButton id="sidebar-favorites" label="Favorites" active={view === 'favorites'} expanded={expanded} onClick={() => onNavigate('favorites')}>
          <Heart size={18} strokeWidth={1.7} />
        </NavButton>
      </div>

      <div className="sidebar-foot">
        <button
          className="sidebar-btn tip"
          onClick={onToggleExpanded}
          data-tip={expanded ? undefined : 'Expand sidebar'}
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-expanded={expanded}
          id="sidebar-toggle"
        >
          {expanded ? <PanelLeftClose size={18} strokeWidth={1.7} /> : <PanelLeft size={18} strokeWidth={1.7} />}
          <span className="sidebar-label">{expanded ? 'Collapse' : 'Expand'}</span>
        </button>
        <NavButton
          id="sidebar-settings"
          label="Settings"
          active={settingsOpen}
          expanded={expanded}
          onClick={onSettings}
          pressed={settingsOpen}
        >
          <Settings size={18} strokeWidth={1.7} />
        </NavButton>
      </div>
    </nav>
  );
}
