import { Heart, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';
import { artworkFor } from '../lib/media';

interface CompactMiniProps {
  state: PlayerState;
  onTogglePause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onFavorite: () => void;
  onShowMain: () => void;
}

export function CompactMini({
  state, onTogglePause, onNext, onPrevious, onFavorite, onShowMain,
}: CompactMiniProps) {
  const track = state.currentTrack;
  const isFav = track ? state.favorites.some(item => item.id === track.id) : false;

  return (
    <div className="compact-mini" role="main" aria-label="Mini player">
      <button className="compact-meta" onClick={onShowMain} title="Show MELO">
        <span className="art-well compact-art">
          {track ? <img src={artworkFor(track)} alt="" /> : null}
        </span>
        <div className="mini-text">
          <div className="mini-title truncate">{track?.title || 'Nothing playing'}</div>
          <div className="mini-artist truncate">{track?.uploader || ''}</div>
        </div>
      </button>
      <div className="mini-controls">
        <button className="ghost-btn sm" onClick={onPrevious} aria-label="Previous" disabled={!track}>
          <SkipBack size={14} fill="currentColor" />
        </button>
        <button className="mini-play" onClick={onTogglePause} disabled={!track} aria-label={state.playing ? 'Pause' : 'Play'}>
          {state.playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </button>
        <button className="ghost-btn sm" onClick={onNext} aria-label="Next" disabled={!track}>
          <SkipForward size={14} fill="currentColor" />
        </button>
        <button
          className={`ghost-btn sm${isFav ? ' fav' : ''}`}
          onClick={onFavorite}
          disabled={!track}
          aria-label={isFav ? 'Unfavorite' : 'Favorite'}
        >
          <Heart size={13} fill={isFav ? 'currentColor' : 'none'} />
        </button>
      </div>
    </div>
  );
}
