import { X, List } from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';
import type { Track, QueueItem } from '../../shared/types';
import { artworkFor, fmt } from '../lib/media';

interface QueuePanelProps {
  open: boolean;
  state: PlayerState;
  onClose: () => void;
  onPlay: (t: Track) => void;
  onClear: () => void;
  onRemove: (index: number) => void;
}

export function QueuePanel({ open, state, onClose, onPlay, onClear, onRemove }: QueuePanelProps) {
  const { currentTrack, queue } = state;
  const hasQueue = queue.length > 0;

  return (
    <div
      className={`drawer${open ? ' open' : ''}`}
      role="complementary"
      aria-label="Queue"
      aria-hidden={!open}
    >
      <div className="drawer-header">
        <div>
          <div className="page-title sm">Queue</div>
          <div className="page-sub">
            {hasQueue ? `${queue.length} up next` : 'Listening now'}
          </div>
        </div>
        <button className="ghost-btn" onClick={onClose} aria-label="Close queue">
          <X size={16} />
        </button>
      </div>

      <div className="drawer-body">
        {currentTrack && (
          <div className="queue-now">
            <span className="art-well">
              <img src={artworkFor(currentTrack)} alt="" />
            </span>
            <div className="queue-now-info">
              <div className="queue-now-label">Now playing</div>
              <div className="truncate" title={currentTrack.title}>{currentTrack.title}</div>
              <div className="muted truncate" title={currentTrack.uploader}>{currentTrack.uploader}</div>
            </div>
          </div>
        )}

        {hasQueue && (
          <div role="list" aria-label="Up next">
            <div className="section-kicker">Up next</div>
            {queue.map((qi: QueueItem, i: number) => {
              const active = currentTrack?.id === qi.track.id;
              return (
                <div
                  key={`${qi.track.id}-${i}`}
                  className={`track-row${active ? ' active' : ''}`}
                  role="listitem"
                  onClick={() => onPlay(qi.track)}
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && onPlay(qi.track)}
                >
                  <span className="track-row-art">
                    <img src={artworkFor(qi.track)} alt="" />
                  </span>
                  <div className="track-row-info">
                    <div className="track-row-name truncate" title={qi.track.title}>{qi.track.title}</div>
                    <div className="track-row-artist truncate" title={`${qi.track.uploader || 'Unknown'} · ${qi.source}`}>
                      {qi.track.uploader || 'Unknown'} · {qi.source}
                    </div>
                  </div>
                  <div className="track-row-tail">
                    {qi.track.duration ? <span className="track-row-dur">{fmt(qi.track.duration)}</span> : null}
                    <button
                      className="ghost-btn sm row-action"
                      onClick={e => { e.stopPropagation(); onRemove(i); }}
                      title="Remove from queue"
                      aria-label={`Remove ${qi.track.title}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
            <button className="text-link" onClick={onClear} id="queue-clear-btn">Clear queue</button>
          </div>
        )}

        {!currentTrack && !hasQueue && (
          <div className="empty-block">
            <List size={28} strokeWidth={1.2} />
            <p>Queue is empty</p>
          </div>
        )}
      </div>
    </div>
  );
}
