import { useMemo, useState } from 'react';
import { Heart } from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';
import type { Track } from '../../shared/types';
import { artworkFor } from '../lib/media';

type Filter = 'all' | 'favorites' | 'recent';

interface LibraryViewProps {
  state: PlayerState;
  onPlay: (t: Track) => void;
  onToggleFavorite: (t?: Track) => void;
  onOpenSearch: () => void;
}

function uniqueTracks(lists: Track[][]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const list of lists) {
    for (const t of list) {
      if (!t?.id || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

export function LibraryView({ state, onPlay, onToggleFavorite, onOpenSearch }: LibraryViewProps) {
  const { history, favorites, currentTrack, queue } = state;
  const [filter, setFilter] = useState<Filter>('all');

  const all = useMemo(
    () => uniqueTracks([
      currentTrack ? [currentTrack] : [],
      favorites,
      history,
      queue.map(q => q.track),
    ]),
    [currentTrack, favorites, history, queue],
  );

  const tracks = filter === 'favorites' ? favorites : filter === 'recent' ? history : all;
  const favIds = useMemo(() => new Set(favorites.map(f => f.id)), [favorites]);

  return (
    <div className="library-page" role="main" aria-label="Library">
      <header className="library-head">
        <h1 className="page-title">Library</h1>
        <p className="page-sub">{tracks.length} track{tracks.length === 1 ? '' : 's'}</p>
      </header>

      <div className="chip-row" role="tablist" aria-label="Library filters">
        {([
          ['all', 'All'],
          ['favorites', 'Favorites'],
          ['recent', 'Recent'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={filter === id}
            className={`chip${filter === id ? ' selected' : ''}`}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tracks.length === 0 ? (
        <div className="empty-block">
          <p>{filter === 'favorites' ? 'No favorites yet.' : 'Your library is empty.'}</p>
          <button className="text-link" onClick={onOpenSearch}>Search for music</button>
        </div>
      ) : (
        <>
          <div className="section-kicker">Featured albums</div>
          <div className="album-grid" role="list">
            {tracks.slice(0, 12).map((track) => {
              const isFav = favIds.has(track.id);
              const isPlaying = currentTrack?.id === track.id;
              return (
                <article
                  key={track.id}
                  className={`album-card${isPlaying ? ' playing' : ''}`}
                  role="listitem"
                >
                  <button
                    className="album-cover"
                    onClick={() => onPlay(track)}
                    aria-label={`Play ${track.title} by ${track.uploader || 'Unknown'}`}
                  >
                    <img src={artworkFor(track)} alt="" />
                    {isFav && (
                      <span className="album-fav-dot" aria-hidden="true" />
                    )}
                  </button>
                  <div className="album-meta">
                    <div className="album-title truncate">{track.title}</div>
                    <div className="album-artist truncate">{track.uploader || 'Unknown'}</div>
                    <button
                      className={`ghost-btn sm${isFav ? ' fav' : ''}`}
                      onClick={() => onToggleFavorite(track)}
                      title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                      aria-label={isFav ? `Unfavorite ${track.title}` : `Favorite ${track.title}`}
                    >
                      <Heart size={13} fill={isFav ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
