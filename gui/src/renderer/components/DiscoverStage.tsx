import { Search } from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';
import type { Track } from '../../shared/types';

interface DiscoverStageProps {
  state: PlayerState;
  onOpenSearch: () => void;
  onPlay: (t: Track) => void;
}

function thumb(id: string) { return `https://img.youtube.com/vi/${id}/mqdefault.jpg`; }
function fmt(s?: number): string {
  if (!s || !Number.isFinite(s)) return '';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

// Stitch: time-of-day greeting with period (e.g. "Good evening.")
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning.';
  if (h < 17) return 'Good afternoon.';
  return 'Good evening.';
}

export function DiscoverStage({ state, onOpenSearch, onPlay }: DiscoverStageProps) {
  const { history, connectionState } = state;
  const isConnected = connectionState === 'connected';
  const hasHistory = history.length > 0;

  return (
    <div className="discover" role="main" aria-label="Music discovery">
      {/* Hero — Stitch cinematic greeting */}
      <div className="discover-hero" style={{ animation: 'slideUp 0.4s ease' }}>
        {isConnected ? (
          <>
            {/* Stitch: uppercase display greeting */}
            <h1 className="discover-heading">
              {greeting()}
            </h1>
            {/* Stitch: prominent centered search input, not just a button */}
            <button
              type="button"
              className="discover-search-wrap"
              onClick={onOpenSearch}
              aria-label="Search for music"
            >
              <Search size={20} strokeWidth={1.8} className="discover-search-icon" />
              <span className="discover-search-placeholder">Search to start listening…</span>
              <kbd className="discover-search-kbd">Ctrl F</kbd>
            </button>
          </>
        ) : (
          <>
            <h1 className="discover-heading discover-heading-sm">YTMusic</h1>
            <p className="discover-sub">
              {connectionState === 'starting' || connectionState === 'connecting'
                ? 'Connecting to the music service…'
                : connectionState === 'error'
                  ? 'Unable to connect. Check the retry button above.'
                  : 'Reconnecting to the music service…'
              }
            </p>
          </>
        )}
      </div>

      {/* Recently played */}
      {hasHistory && (
        <div className="history-section" style={{ animation: 'slideUp 0.45s ease 0.06s both' }}>
          <div className="section-header">
            <span className="section-title">Recently Played</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{history.length} tracks</span>
          </div>

          <div role="list" aria-label="Recently played tracks">
            {history.slice(0, 10).map((track, i) => (
              <div
                key={`${track.id}-${i}`}
                className="track-row"
                role="listitem"
                onClick={() => onPlay(track)}
                onKeyDown={e => e.key === 'Enter' && onPlay(track)}
                tabIndex={0}
                aria-label={`Play ${track.title} by ${track.uploader}`}
              >
                <div className="track-row-num" aria-hidden="true">{i + 1}</div>
                <div className="track-row-art">
                  <img src={thumb(track.id)} alt="" loading="lazy" />
                  <div className="track-row-art-overlay" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </div>
                </div>
                <div className="track-row-info">
                  <div className="track-row-name truncate">{track.title || 'Unknown Track'}</div>
                  <div className="track-row-artist truncate">{track.uploader || 'Unknown Artist'}</div>
                </div>
                {track.duration && (
                  <div className="track-row-dur">{fmt(track.duration)}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
