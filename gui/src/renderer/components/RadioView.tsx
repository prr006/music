import { Radio } from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';
import type { Track } from '../../shared/types';
import { artworkFor, fmt } from '../lib/media';

interface RadioViewProps {
  state: PlayerState;
  onPlay: (t: Track) => void;
  onOpenSearch: () => void;
}

export function RadioView({ state, onPlay, onOpenSearch }: RadioViewProps) {
  const radio = state.queue.filter(q => q.source === 'radio');
  const { currentTrack } = state;

  return (
    <div className="library-page" role="main" aria-label="Radio mix">
      <header className="library-head">
        <h1 className="page-title">Radio</h1>
        <p className="page-sub">
          {radio.length ? `${radio.length} mix track${radio.length === 1 ? '' : 's'}` : 'Engine mix'}
        </p>
      </header>

      {radio.length === 0 ? (
        <div className="empty-block">
          <Radio size={28} strokeWidth={1.2} />
          <p>Play a song to let the engine fill a radio mix around it.</p>
          <button className="text-link" onClick={onOpenSearch}>Search for a seed track</button>
        </div>
      ) : (
        <div className="track-list" role="list">
          {radio.map((item, i) => {
            const track = item.track;
            const isPlaying = currentTrack?.id === track.id;
            return (
              <div
                key={`${track.id}-${i}`}
                className={`track-row${isPlaying ? ' active' : ''}`}
                role="listitem"
                onClick={() => onPlay(track)}
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && onPlay(track)}
              >
                <div className="track-row-num">{i + 1}</div>
                <div className="track-row-art">
                  <img src={artworkFor(track)} alt="" />
                </div>
                <div className="track-row-info">
                  <div className="track-row-name truncate" title={track.title}>{track.title}</div>
                  <div className="track-row-artist truncate" title={track.uploader || 'Unknown'}>{track.uploader || 'Unknown'}</div>
                </div>
                <div className="track-row-tail">
                  {track.duration ? <span className="track-row-dur">{fmt(track.duration)}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
