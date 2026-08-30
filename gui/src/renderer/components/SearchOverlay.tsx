import { useEffect, useRef, useState, useCallback } from 'react';
import { Search, Play, ListPlus, SkipForward } from 'lucide-react';
import type { Track } from '../../shared/types';
import { artworkFor, fmt } from '../lib/media';

interface SearchOverlayProps {
  results: Track[];
  searching: boolean;
  currentTrack: Track | null;
  loadingTrack: Track | null;
  recent: Track[];
  onSearch: (q: string) => void;
  onPlay: (t: Track) => void;
  onAddToQueue: (t: Track) => void;
  onPlayNext: (t: Track) => void;
  onClose: () => void;
}

export function SearchOverlay({
  results, searching, currentTrack, loadingTrack, recent,
  onSearch, onPlay, onAddToQueue, onPlayNext, onClose,
}: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  useEffect(() => { setFocusedIdx(null); }, [results]);

  useEffect(() => {
    if (focusedIdx === null) return;
    document.querySelector<HTMLElement>('.search-card .track-row.focused')
      ?.scrollIntoView({ block: 'nearest' });
  }, [focusedIdx]);

  const handlePlay = useCallback((t: Track) => {
    onPlay(t);
    onClose();
  }, [onPlay, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (!results.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIdx(prev => prev === null ? 0 : Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIdx(prev => prev === null ? results.length - 1 : Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && focusedIdx !== null && results[focusedIdx]) {
        if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
        e.preventDefault();
        handlePlay(results[focusedIdx]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, results, focusedIdx, handlePlay]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length >= 2) {
      debounceRef.current = setTimeout(() => onSearch(q), 380);
    }
  }, [onSearch]);

  const recentUnique = recent.filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i).slice(0, 8);

  return (
    <div className="search-scrim" onClick={onClose} role="presentation">
      <div
        className="search-card"
        role="dialog"
        aria-modal="true"
        aria-label="Search for music"
        onClick={e => e.stopPropagation()}
      >
        <form
          className="search-input-row"
          onSubmit={e => {
            e.preventDefault();
            if (focusedIdx !== null && results[focusedIdx]) {
              handlePlay(results[focusedIdx]);
              return;
            }
            if (query.trim()) onSearch(query);
          }}
          role="search"
        >
          <Search size={16} strokeWidth={1.7} />
          <input
            ref={inputRef}
            id="search-input"
            type="search"
            className="search-input"
            value={query}
            onChange={handleChange}
            placeholder="Search tracks, artists, albums…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search query"
          />
          {searching && <div className="spin-sm" />}
          <button type="button" className="esc-btn" onClick={onClose} id="search-close-btn">
            Esc
          </button>
        </form>

        {!query.trim() && recentUnique.length > 0 && (
          <div className="search-section">
            <div className="section-kicker">
              <span className="kicker-clock" aria-hidden="true">◌</span> Recent
            </div>
            <div className="chip-row wrap">
              {recentUnique.map(t => (
                <button
                  key={t.id}
                  className="chip"
                  title={t.title}
                  onClick={() => handlePlay(t)}
                >
                  {t.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {searching && (
          <div className="search-section" aria-busy="true">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="track-row" style={{ pointerEvents: 'none', opacity: 1 - i * 0.12 }}>
                <div className="skel" style={{ width: 64, height: 36, borderRadius: 6 }} />
                <div className="track-row-info">
                  <div className="skel" style={{ width: '55%', height: 10, marginBottom: 8 }} />
                  <div className="skel" style={{ width: '32%', height: 8 }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!searching && results.length > 0 && (
          <div className="search-section" role="list">
            <div className="section-kicker">Songs</div>
            {results.map((track, i) => {
              const isPlaying = currentTrack?.id === track.id && !loadingTrack;
              const isFocused = focusedIdx === i;
              return (
                <div
                  key={track.id}
                  className={`track-row${isPlaying ? ' active' : ''}${isFocused ? ' focused' : ''}`}
                  role="listitem"
                  onMouseEnter={() => setFocusedIdx(i)}
                  onClick={() => handlePlay(track)}
                >
                  <div className="track-row-art">
                    <img src={artworkFor(track)} alt="" />
                  </div>
                  <div className="track-row-info">
                    <div className="track-row-name truncate" title={track.title}>{track.title}</div>
                    <div className="track-row-artist truncate" title={track.uploader || 'Unknown artist'}>{track.uploader || 'Unknown artist'}</div>
                  </div>
                  <div className="track-row-tail">
                    {track.duration ? <span className="track-row-dur">{fmt(track.duration)}</span> : null}
                    <div className="track-row-actions">
                      <button className="ghost-btn sm" onClick={e => { e.stopPropagation(); onPlayNext(track); }} title="Play next" aria-label="Play next">
                        <SkipForward size={13} />
                      </button>
                      <button className="ghost-btn sm" onClick={e => { e.stopPropagation(); onAddToQueue(track); }} title="Add to queue" aria-label="Add to queue">
                        <ListPlus size={13} />
                      </button>
                      <button className="ghost-btn sm" onClick={e => { e.stopPropagation(); handlePlay(track); }} title="Play" aria-label="Play">
                        <Play size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!searching && query.trim().length >= 2 && results.length === 0 && (
          <div className="empty-block sm">
            <p>No results for “{query}”</p>
          </div>
        )}
      </div>
    </div>
  );
}
