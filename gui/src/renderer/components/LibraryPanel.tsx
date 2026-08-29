import { X, Library, Clock, Heart } from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';
import type { Track } from '../../shared/types';

interface LibraryPanelProps {
  open: boolean;
  state: PlayerState;
  onClose: () => void;
  onPlay: (t: Track) => void;
  onOpenSearch: () => void;
  onToggleFavorite: (t?: Track) => void;
}

function thumb(id: string) { return `https://img.youtube.com/vi/${id}/mqdefault.jpg`; }
function fmt(s?: number): string {
  if (!s || !Number.isFinite(s)) return '';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

export function LibraryPanel({ open, state, onClose, onPlay, onOpenSearch, onToggleFavorite }: LibraryPanelProps) {
  const { history, favorites, currentTrack } = state;
  const hasHistory = history.length > 0;
  const hasFavorites = favorites.length > 0;

  return (
    <div
      className={`panel${open ? ' open' : ''}`}
      role="complementary"
      aria-label="Library"
      aria-hidden={!open}
    >
      {/* Stitch dual-label header */}
      <div className="panel-header">
        <div className="panel-title-group">
          <span className="panel-title">Library</span>
          <span className="panel-subtitle">Favorites &amp; Recently Played</span>
        </div>
        <button className="panel-close" onClick={onClose} aria-label="Close library">
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="panel-body">
        {/* Favorites */}
        <div className="lib-section">
          <div className="lib-section-label">
            <Heart size={10} style={{ display: 'inline', marginRight: 4 }} aria-hidden="true" />
            Favorites
            {hasFavorites && <span style={{ color: 'var(--text-4)', fontWeight: 500, marginLeft: 6 }}>{favorites.length}</span>}
          </div>

          {hasFavorites ? (
            <div role="list" aria-label="Favorite tracks">
              {favorites.map((track) => {
                const isPlaying = currentTrack?.id === track.id;
                return (
                  <div
                    key={track.id}
                    className={`queue-item lib-row${isPlaying ? ' active' : ''}`}
                    role="listitem"
                    onClick={() => onPlay(track)}
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && onPlay(track)}
                    aria-label={`${isPlaying ? 'Now playing: ' : ''}${track.title} by ${track.uploader}`}
                  >
                    <img
                      src={thumb(track.id)}
                      alt=""
                      className="queue-item-art"
                    />
                    <div className="queue-item-info">
                      <div
                        className="queue-item-title truncate"
                        style={isPlaying ? { color: 'var(--accent)' } : undefined}
                      >
                        {track.title || 'Unknown'}
                      </div>
                      <div className="queue-item-artist truncate">
                        {track.uploader || 'Unknown'}
                      </div>
                    </div>
                    {track.duration && (
                      <span className="queue-item-dur">{fmt(track.duration)}</span>
                    )}
                    <button
                      className="ib ib-sm lib-row-action"
                      onClick={e => {
                        e.stopPropagation();
                        onToggleFavorite(track);
                      }}
                      title="Remove from favorites"
                      aria-label={`Remove ${track.title} from favorites`}
                    >
                      <Heart size={12} fill="currentColor" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="lib-empty" role="status">
              Tap the heart on a playing song to save it here.
            </div>
          )}
        </div>

        {/* Recently played */}
        <div className="lib-section">
          <div className="lib-section-label">
            <Clock size={10} style={{ display: 'inline', marginRight: 4 }} aria-hidden="true" />
            Recently Played
          </div>

          {hasHistory ? (
            <div role="list" aria-label="Recently played tracks">
              {history.slice(0, 15).map((track, i) => {
                const isPlaying = currentTrack?.id === track.id;
                return (
                  <div
                    key={`${track.id}-${i}`}
                    className={`queue-item${isPlaying ? ' active' : ''}`}
                    role="listitem"
                    onClick={() => onPlay(track)}
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && onPlay(track)}
                    aria-label={`${isPlaying ? 'Now playing: ' : ''}${track.title} by ${track.uploader}`}
                  >
                    <img
                      src={thumb(track.id)}
                      alt=""
                      className="queue-item-art"
                    />
                    <div className="queue-item-info">
                      <div
                        className="queue-item-title truncate"
                        style={isPlaying ? { color: 'var(--accent)' } : undefined}
                      >
                        {track.title || 'Unknown'}
                      </div>
                      <div className="queue-item-artist truncate">
                        {track.uploader || 'Unknown'}
                      </div>
                    </div>
                    {track.duration && (
                      <span className="queue-item-dur">{fmt(track.duration)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="lib-empty" role="status">
              Play music to build your history.
            </div>
          )}
        </div>

        {/* About section */}
        <div className="library-note">
          <div className="library-note-heading">
            <Library size={14} />
            <span style={{ fontWeight: 600, color: 'var(--text-2)' }}>YTMusic Player</span>
          </div>
          <p>Private playback is handled locally through mpv and yt-dlp.</p>
          <p className="library-note-copy">
            Session history is kept in memory — play more to build your library.
          </p>
        </div>

        {/* Search shortcut */}
        <button
          id="library-search-btn"
          className="library-search-btn"
          onClick={() => { onClose(); onOpenSearch(); }}
          aria-label="Open search"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          Search for new music
        </button>
      </div>
    </div>
  );
}
