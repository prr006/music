import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';
import { artworkFor, fmt, fmtRemaining } from '../lib/media';

interface MiniPlayerProps {
  state: PlayerState;
  onTogglePause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeekTo: (pos: number) => void;
  onOpenHome: () => void;
}

export function MiniPlayer({
  state, onTogglePause, onNext, onPrevious, onSeekTo, onOpenHome,
}: MiniPlayerProps) {
  const { currentTrack, playing, loading, position, duration } = state;
  if (!currentTrack) return null;

  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <div className="mini-player" role="region" aria-label="Mini player">
      <button
        className="mini-progress"
        aria-label="Seek"
        onClick={e => {
          const r = e.currentTarget.getBoundingClientRect();
          const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
          onSeekTo(p * duration);
        }}
      >
        <span style={{ width: `${pct}%` }} />
      </button>

      <button className="mini-meta" onClick={onOpenHome} title="Open now playing">
        <img src={artworkFor(currentTrack)} alt="" className="mini-art" />
        <div className="mini-text">
          <div className="mini-title truncate" title={currentTrack.title}>{currentTrack.title}</div>
          <div className="mini-artist truncate" title={currentTrack.uploader || 'Unknown'}>{currentTrack.uploader || 'Unknown'}</div>
        </div>
      </button>

      <div className="mini-controls">
        <button className="ghost-btn sm" onClick={onPrevious} aria-label="Previous" id="mini-prev">
          <SkipBack size={14} fill="currentColor" />
        </button>
        <button
          className="mini-play"
          onClick={onTogglePause}
          disabled={loading}
          aria-label={playing ? 'Pause' : 'Play'}
          id="mini-play"
        >
          {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </button>
        <button className="ghost-btn sm" onClick={onNext} aria-label="Next" id="mini-next">
          <SkipForward size={14} fill="currentColor" />
        </button>
      </div>

      <div className="mini-time">
        {fmt(position)} / {fmtRemaining(position, duration).replace('-', '')}
      </div>
    </div>
  );
}
