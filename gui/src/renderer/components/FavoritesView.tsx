import { Heart } from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';
import type { Track } from '../../shared/types';
import { artworkFor, fmt } from '../lib/media';

interface FavoritesViewProps {
  state: PlayerState;
  onPlay: (t: Track) => void;
  onToggleFavorite: (t?: Track) => void;
  onOpenSearch: () => void;
}

export function FavoritesView({ state, onPlay, onToggleFavorite, onOpenSearch }: FavoritesViewProps) {
  const { favorites, currentTrack } = state;

  return (
    <div className="library-page" role="main" aria-label="Favorites">
      <header className="library-head">
        <h1 className="page-title">Favorites</h1>
        <p className="page-sub">{favorites.length} track{favorites.length === 1 ? '' : 's'}</p>
      </header>

      {favorites.length === 0 ? (
        <div className="empty-block">
          <Heart size={28} strokeWidth={1.2} />
          <p>Tap the heart on a playing song to save it here.</p>
          <button className="text-link" onClick={onOpenSearch}>Search for music</button>
        </div>
      ) : (
        <div className="track-list" role="list">
          {favorites.map((track) => {
            const isPlaying = currentTrack?.id === track.id;
            return (
              <div
                key={track.id}
                className={`track-row${isPlaying ? ' active' : ''}`}
                role="listitem"
                onClick={() => onPlay(track)}
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && onPlay(track)}
              >
                <div className="track-row-art">
                  <img src={artworkFor(track)} alt="" />
                </div>
                <div className="track-row-info">
                  <div className="track-row-name truncate" title={track.title}>{track.title}</div>
                  <div className="track-row-artist truncate" title={track.uploader || 'Unknown'}>{track.uploader || 'Unknown'}</div>
                </div>
                {track.duration ? <span className="track-row-dur">{fmt(track.duration)}</span> : null}
                <button
                  className="ghost-btn sm fav"
                  onClick={e => { e.stopPropagation(); onToggleFavorite(track); }}
                  title="Remove from favorites"
                  aria-label={`Remove ${track.title} from favorites`}
                >
                  <Heart size={14} fill="currentColor" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
