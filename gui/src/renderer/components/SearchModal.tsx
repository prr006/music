import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { Track } from '../../shared/types';
import { Search, XCircle } from 'lucide-react';

interface SearchModalProps {
  state: any; // PlayerState from useBackend
  onClose: () => void;
  onPlay: (t: Track) => void;
  onAddToQueue: (t: Track) => void;
  onPlayNext: (t: Track) => void;
  currentTrack: Track | null;
  loadingTrack: Track | null;
}

export function SearchModal({ state, onClose, onPlay, onAddToQueue, onPlayNext, currentTrack, loadingTrack }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const ref = useRef<HTMLInputElement>(null);

  // Load recent searches from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('ytmusic-recent-searches');
      if (stored) setRecentSearches(JSON.parse(stored));
    } catch {}
  }, []);

  // Save recent searches
  useEffect(() => {
    try {
      localStorage.setItem('ytmusic-recent-searches', JSON.stringify(recentSearches));
    } catch {}
  }, [recentSearches]);

  const fmt = (s?: number) => s ? `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}` : '';

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (!recentSearches.includes(q)) {
      setRecentSearches([q, ...recentSearches].slice(0, 5));
    }
    onClose();
  }, [query, recentSearches, onClose]);

  const goSearch = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    if (!recentSearches.includes(q)) {
      setRecentSearches([q, ...recentSearches].slice(0, 5));
    }
    onClose();
  }, [query, recentSearches, onClose]);

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  }, []);

  const clearRecent = useCallback(() => {
    setRecentSearches([]);
    try { localStorage.removeItem('ytmusic-recent-searches'); } catch {}
  }, []);

  return (
    <div className="search-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={goSearch} className="search-form">
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            ref={ref}
            type="text"
            value={query}
            onChange={onInputChange}
            placeholder="Search for songs, artists, or albums"
            autoFocus
          />
          <button type="submit" className="search-submit">
            <Search className="search-submit-icon" size={16} />
          </button>
          <button type="button" className="search-clear" onClick={clearRecent} title="Clear recent">✕</button>
        </form>

        {/* Recent searches */}
        {recentSearches.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--yt-border)' }}>
            <div style={{ fontSize: 12, color: 'var(--yt-text-2)', marginBottom: 8 }}>Recent</div>
            {recentSearches.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 4, color: 'var(--yt-text)', cursor: 'pointer', transition: 'background 0.1s' }} onClick={() => { setQuery(s); goSearch(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <span>{s}</span>
              </div>
            ))}
          </div>
        )}

        {/* Search results */}
        {searching && results.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--yt-text-3)' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <div style={{ marginTop: 8 }}>No results found</div>
          </div>
        )}

        {!searching && results.length > 0 && (
          <div style={{ marginTop: 16, maxHeight: 300, overflowY: 'auto' }}>
            <div style={{ fontSize: 12, color: 'var(--yt-text-3)', marginBottom: 8 }}>{results.length} results</div>
            {results.map((t, i) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 6, cursor: 'pointer', transition: 'background 0.1s', marginBottom: 6 }} onClick={() => onPlay(t)}>
                <div style={{ width: 40, height: 40, borderRadius: 4, objectFit: 'cover', background: 'var(--yt-surface-3)', flexShrink: 0 }}>
                  <img src={t.url.includes('youtube.com') ? t.url.replace('watch?v=', 'img.youtube.com/vi/') + '/mqdefault.jpg' : 'https://img.youtube.com/vi/' + t.id + '/mqdefault.jpg'} alt={t.title} style={{ width: '100%', height: '100%', borderRadius: 4 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--yt-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || 'Unknown'}</div>
                  <div style={{ fontSize: 11, color: 'var(--yt-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.uploader || 'Unknown artist'}</div>
                </div>
                <span style={{ fontSize: 11, color: 'var(--yt-text-3)', minWidth: 36, textAlign: 'right' }}>
<span>{fmt(t.duration)}</span>
</span>
              </div>
            ))}
          </div>
        )}

        {!searching && results.length === 0 && currentTrack && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--yt-text-3)' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <div style={{ marginTop: 8 }}>Nothing playing yet</div>
            <div style={{ marginTop: 4 }}>Search for something to listen to</div>
          </div>
        )}
      </div>

      {/* Close button */}
      <button className="search-close" onClick={onClose} style={{ position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 50, background: 'var(--yt-surface-2)', color: 'var(--yt-text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: 'pointer' }} aria-label="Close search">
        <XCircle size={18} />
      </button>
    </div>
  );
}