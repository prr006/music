import { useEffect, useRef, useState, useCallback } from 'react';
import { Search, Play, ListPlus, SkipForward, X } from 'lucide-react';
import type { Track } from '../../shared/types';

interface SearchOverlayProps {
  results: Track[];
  searching: boolean;
  currentTrack: Track | null;
  loadingTrack: Track | null;
  onSearch: (q: string) => void;
  onPlay: (t: Track) => void;
  onAddToQueue: (t: Track) => void;
  onPlayNext: (t: Track) => void;
  onClose: () => void;
}

function thumb(id: string) { return `https://img.youtube.com/vi/${id}/mqdefault.jpg`; }
function fmt(s?: number): string {
  if (!s || !Number.isFinite(s)) return '';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

export function SearchOverlay({
  results,
  searching,
  currentTrack,
  loadingTrack,
  onSearch,
  onPlay,
  onAddToQueue,
  onPlayNext,
  onClose,
}: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedRowRef = useRef<HTMLDivElement | null>(null);

  // Auto-focus input
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // Reset focus when results change
  useEffect(() => {
    setFocusedIdx(null);
  }, [results]);

  // Scroll focused row into view
  useEffect(() => {
    focusedRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusedIdx]);

  const handlePlay = useCallback((t: Track) => {
    onPlay(t);
    onClose();
  }, [onPlay, onClose]);

  // Keyboard navigation
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
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedIdx !== null && results[focusedIdx]) {
          handlePlay(results[focusedIdx]);
        } else if (query.trim()) {
          onSearch(query);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, results, focusedIdx, query]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length >= 2) {
      debounceRef.current = setTimeout(() => onSearch(q), 380);
    }
  }, [onSearch]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) onSearch(query);
  }, [query, onSearch]);

  const hasResults = results.length > 0;

  return (
    <div
      className="search-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Search for music"
    >
      {/* Header */}
      <div className="search-header">
        <form className="search-input-wrap" onSubmit={handleSubmit} role="search">
          {/* Stitch: 28px search icon on the left for display-scale input */}
          <Search size={28} strokeWidth={1.5} color="var(--text-3)" aria-hidden="true" />
          <input
            ref={inputRef}
            id="search-input"
            type="search"
            className="search-input"
            value={query}
            onChange={handleChange}
            placeholder="Search for music…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search query"
            aria-autocomplete="list"
          />
          {searching && <div className="spin-sm" aria-hidden="true" />}
        </form>

        <button
          id="search-close-btn"
          className="search-close-btn"
          onClick={onClose}
          aria-label="Close search"
        >
          <X size={14} />
          <span>Esc</span>
        </button>
      </div>

      {/* Body */}
      <div className="search-body">

        {/* Loading skeleton */}
        {searching && (
          <div
            className="search-skeleton"
            aria-busy="true"
            aria-label="Loading results"
            role="status"
          >
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="track-row"
                style={{ opacity: 1 - i * 0.12, pointerEvents: 'none' }}
              >
                <div className="track-row-num">
                  <div className="skel" style={{ width: 14, height: 10 }} />
                </div>
                <div className="track-row-art">
                  <div className="skel" style={{ width: '100%', height: '100%', borderRadius: 'var(--r-sm)' }} />
                </div>
                <div className="track-row-info">
                  <div className="skel" style={{ width: `${52 + (i % 3) * 12}%`, height: 12, marginBottom: 5 }} />
                  <div className="skel" style={{ width: `${30 + (i % 3) * 8}%`, height: 10 }} />
                </div>
                <div className="skel" style={{ width: 32, height: 10 }} />
              </div>
            ))}
          </div>
        )}

        {/* Results — Stitch: "Songs" heading in headline scale */}
        {!searching && hasResults && (
          <div>
            {/* Section heading: "Songs" */}
            <div className="search-section-label">Songs</div>
            {/* Count in label-sm caps */}
            <div className="search-results-count">{results.length} result{results.length !== 1 ? 's' : ''}</div>
            <div role="list" aria-label="Search results">
              {results.map((track, i) => {
                const isPlaying = currentTrack?.id === track.id && !loadingTrack;
                const isLoading = loadingTrack?.id === track.id;
                const isFocused = focusedIdx === i;

                return (
                  <div
                    key={track.id}
                    ref={isFocused ? focusedRowRef : null}
                    className={[
                      'track-row',
                      isPlaying ? 'active' : '',
                      isFocused ? 'focused' : '',
                    ].filter(Boolean).join(' ')}
                    role="listitem"
                    onMouseEnter={() => setFocusedIdx(i)}
                    onMouseLeave={() => setFocusedIdx(null)}
                    onClick={() => handlePlay(track)}
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && handlePlay(track)}
                    aria-label={`${track.title} by ${track.uploader}${track.duration ? `, ${fmt(track.duration)}` : ''}`}
                    aria-selected={isFocused}
                    style={{ animation: `fadeInUp ${Math.min(0.3 + i * 0.03, 0.5)}s var(--ease-std) both` }}
                  >
                    {/* Track number / EQ indicator */}
                    <div className="track-row-num" aria-hidden="true">
                      {isPlaying
                        ? <div className="eq" style={{ height: 11 }}>
                            <div className="eq-bar" />
                            <div className="eq-bar" />
                            <div className="eq-bar" />
                          </div>
                        : isLoading
                          ? <div className="spin-sm" />
                          : <span>{i + 1}</span>
                      }
                    </div>

                    {/* Artwork */}
                    <div className="track-row-art">
                      <img src={thumb(track.id)} alt="" loading="lazy" />
                      <div className="track-row-art-overlay" aria-hidden="true">
                        {isLoading
                          ? <div className="spin-sm" style={{ borderColor: 'rgba(255,255,255,0.2)', borderTopColor: '#fff' }} />
                          : <Play size={13} fill="#fff" color="#fff" />
                        }
                      </div>
                    </div>

                    {/* Info */}
                    <div className="track-row-info">
                      <div className="track-row-name truncate">{track.title || 'Unknown'}</div>
                      <div className="track-row-artist truncate">{track.uploader || 'Unknown artist'}</div>
                    </div>

                    {/* Duration (hidden when focused — shows actions instead) */}
                    {!isFocused && track.duration && (
                      <div className="track-row-dur">{fmt(track.duration)}</div>
                    )}

                    {/* Actions (visible on hover/focus) */}
                    <div className="track-row-actions">
                      <button
                        className="ib ib-sm"
                        onClick={e => { e.stopPropagation(); onPlayNext(track); }}
                        title="Play next"
                        aria-label={`Play next: ${track.title}`}
                      >
                        <SkipForward size={13} />
                      </button>
                      <button
                        className="ib ib-sm"
                        onClick={e => { e.stopPropagation(); onAddToQueue(track); }}
                        title="Add to queue"
                        aria-label={`Add to queue: ${track.title}`}
                      >
                        <ListPlus size={13} />
                      </button>
                      <button
                        className="ib ib-sm"
                        onClick={e => { e.stopPropagation(); handlePlay(track); }}
                        title="Play now"
                        aria-label={`Play: ${track.title}`}
                      >
                        <Play size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty / prompt states */}
        {!searching && !hasResults && (
          <div className="search-empty" role="status">
            {query.trim().length >= 2 ? (
              <>
                <Search size={28} strokeWidth={1.2} />
                <p className="search-empty-heading">No results for "{query}"</p>
                <p style={{ fontSize: 'var(--fs-sm)' }}>
                  Try a different spelling or search term.
                </p>
              </>
            ) : (
              <>
                <Search size={28} strokeWidth={1.2} />
                <p className="search-empty-heading">Search for music</p>
                <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-3)' }}>
                  Type to search songs, artists, or albums.
                  <br />
                  Use ↑ ↓ to navigate · Enter to play
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
