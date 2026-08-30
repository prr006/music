import { Search } from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';
import type { Track } from '../../shared/types';
import { artworkFor, fmt } from '../lib/media';

interface DiscoverStageProps {
  state: PlayerState;
  onOpenSearch: () => void;
  onPlay: (t: Track) => void;
}

export function DiscoverStage({ state, onOpenSearch, onPlay }: DiscoverStageProps) {
  const { history, connectionState } = state;
  const isConnected = connectionState === 'connected';

  return (
    <div className="discover" role="main" aria-label="Discover">
      <div className="discover-hero">
        <div className="discover-kicker">AURA</div>
        <h1 className="discover-heading">
          {isConnected ? 'Press play on the quiet hours.' : 'Connecting'}
        </h1>
        {isConnected ? (
          <button
            type="button"
            className="discover-search"
            onClick={onOpenSearch}
            aria-label="Search for music"
          >
            <Search size={16} strokeWidth={1.8} />
            <span>Search tracks, artists, albums…</span>
            <kbd>Ctrl+F</kbd>
          </button>
        ) : (
          <p className="discover-sub">
            {connectionState === 'error'
              ? 'Unable to reach the player backend.'
              : 'Starting the music engine…'}
          </p>
        )}
      </div>

      {history.length > 0 && (
        <div className="discover-recent">
          <div className="section-kicker">Recently played</div>
          <div className="recent-row" role="list">
            {history.slice(0, 6).map((track, i) => (
              <button
                key={`${track.id}-${i}`}
                className="recent-chip-card"
                onClick={() => onPlay(track)}
                aria-label={`Play ${track.title}`}
              >
                <img src={artworkFor(track)} alt="" />
                <span className="truncate" title={track.title}>{track.title}</span>
                <span className="muted truncate" title={track.uploader}>{track.uploader}</span>
                {track.duration ? <span className="muted">{fmt(track.duration)}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
