import React from 'react';
import type { PlayerState } from '../hooks/useBackend';
import type { Track, QueueItem } from '../../shared/types';
import { Music, Library as LibIcon, Search } from 'lucide-react';

interface LibraryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (section: string) => void;
  state: PlayerState;
}

export function LibraryPanel({ isOpen, onClose, onNavigate, state }: LibraryPanelProps) {
  const fmt = (s?: number) => s ? `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}` : '';

  const sections = [
    { key: 'recent', title: 'Recently Played', icon: Music, items: [] as { track: Track; source: string }[] },
    { key: 'library', title: 'Library', icon: LibIcon, items: [] as { track: Track; source: string }[] },
    { key: 'search', title: 'Search', icon: Search, items: [] as { track: Track; source: string }[] },
    { key: 'playlists', title: 'Playlists', icon: Music, items: [] as { track: Track; source: string }[] },
    { key: 'artists', title: 'Artists', icon: Music, items: [] as { track: Track; source: string }[] },
    { key: 'downloads', title: 'Downloads', icon: Music, items: [] as { track: Track; source: string }[] },
  ];

  if (!isOpen) return null;

  return (
    <div className="library-panel" onClick={(e) => e.stopPropagation()}>
      <div style={{ padding: 'var(--yt-spacing-5) var(--yt-spacing-4)' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--yt-spacing-4)' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--yt-text)' }}>Library</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--yt-text-3)', cursor: 'pointer', fontSize: 14 }} aria-label="Close library">✕</button>
        </header>

        <nav style={{ display: 'flex', gap: 'var(--yt-spacing-2)', marginBottom: 'var(--yt-spacing-4)' }}>
          {sections.map((section) => (
            <button
              key={section.key}
              style={{
                padding: 'var(--yt-spacing-2) var(--yt-spacing-3)',
                borderRadius: 'var(--yt-radius-sm)',
                fontSize: 12,
                fontWeight: 500,
                color: section.key === 'recent' ? 'var(--yt-accent)' : 'var(--yt-text-2)',
                cursor: 'pointer',
                border: '1px solid transparent',
                transition: 'all 0.15s'
              }}
              onMouseOver={() => {}}
              onMouseOut={() => {}}
              onClick={() => onNavigate?.(section.key)}
            >
              {section.icon && <section.icon width={16} height={16} />}
              {section.title}
            </button>
          ))}
        </nav>

        {/* Recently Played items */}
        {sections[0].key === 'recent' && sections[0].items.length > 0 && (
          <div style={{ marginBottom: 'var(--yt-spacing-4)' }}>
            <div style={{ fontSize: 12, color: 'var(--yt-text-2)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Recently Played</div>
            {sections[0].items.slice(0, 8).map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--yt-spacing-3)', padding: 'var(--yt-spacing-xs) var(--yt-spacing-3)', borderRadius: 'var(--yt-radius-sm)', color: 'var(--yt-text)', cursor: 'pointer', fontSize: 12, transition: 'background 0.1s' }} onMouseOver={() => {} } onMouseOut={() => {}}>
                <img src={item.track.artwork || 'https://via.placeholder.com/36'} alt={item.track.title} className="artwork" style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.track.title || 'Unknown'}</div>
                  <div style={{ fontSize: 10, color: 'var(--yt-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.track.uploader || 'Unknown artist'}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Library sections placeholders */}
        {sections.filter(s => s.key !== 'recent').map((section) => (
          <div key={section.key} style={{ marginBottom: 'var(--yt-spacing-4)' }}>
            <div style={{ fontSize: 12, color: 'var(--yt-text-2)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{section.title}</div>
            <div style={{ color: 'var(--yt-text-3)', fontSize: 12, padding: 16, border: '1px dashed var(--yt-border)', borderRadius: 'var(--yt-radius-sm)' }}>
              Not available yet
            </div>
          </div>
        ))}

        {/* Footer */}
        <footer style={{ marginTop: 'var(--yt-spacing-4)', paddingTop: 'var(--yt-spacing-3)', borderTop: '1px solid var(--yt-border)', fontSize: 12, color: 'var(--yt-text-2)' }}>
          <div>YTMusic • Version 1.0</div>
        </footer>
      </div>
    </div>
  );
}