import { X, List } from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';
import type { Track, QueueItem } from '../../shared/types';

interface QueuePanelProps {
  open: boolean;
  state: PlayerState;
  onClose: () => void;
  onPlay: (t: Track) => void;
  onClear: () => void;
  onRemove: (index: number) => void;
}

function thumb(id: string) { return `https://img.youtube.com/vi/${id}/mqdefault.jpg`; }
function fmt(s?: number): string {
  if (!s || !Number.isFinite(s)) return '';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

export function QueuePanel({ open, state, onClose, onPlay, onClear, onRemove }: QueuePanelProps) {
  const { currentTrack, queue } = state;
  const hasQueue = queue.length > 0;
  const manualCount = queue.filter(item => item.source === 'manual').length;

  return (
    <div
      className={`panel${open ? ' open' : ''}`}
      role="complementary"
      aria-label="Queue"
      aria-hidden={!open}
    >
      {/* Stitch dual-label header: "Your Stage" + "LISTENING NOW" */}
      <div className="panel-header">
        <div className="panel-title-group">
          <span className="panel-title">Your Stage</span>
          <span className="panel-subtitle">
            {hasQueue ? `${queue.length} queued${manualCount ? ` · ${manualCount} picked` : ''}` : 'Listening Now'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          <button className="panel-close" onClick={onClose} aria-label="Close queue">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="panel-body">
        {/* Now playing — Stitch: tonal highlight card, not accent tint */}
        {currentTrack && (
          <div role="region" aria-label="Now playing">
            <div className="queue-now-section-label">Now Playing</div>
            <div className="queue-now-playing">
              <img
                src={thumb(currentTrack.id)}
                alt=""
                className="queue-now-art"
              />
              <div className="queue-now-info">
                <div className="queue-now-title truncate">{currentTrack.title || 'Unknown'}</div>
                <div className="queue-now-artist truncate">{currentTrack.uploader || 'Unknown'}</div>
              </div>
            </div>
          </div>
        )}

        {/* Next up */}
        {hasQueue && (
          <div role="list" aria-label="Up next">
            <div className="queue-section-label">Up Next</div>
            {queue.map((qi: QueueItem, i: number) => {
              const isCurrentlyPlaying = currentTrack?.id === qi.track.id;
              return (
                <div
                  key={`${qi.track.id}-${i}`}
                  className={`queue-item${isCurrentlyPlaying ? ' active' : ''}`}
                  role="listitem"
                  onClick={() => onPlay(qi.track)}
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && onPlay(qi.track)}
                  aria-label={`${qi.track.title} by ${qi.track.uploader}`}
                >
                  <img
                    src={thumb(qi.track.id)}
                    alt=""
                    className="queue-item-art"
                  />
                  <div className="queue-item-info">
                    <div className="queue-item-title-line">
                      <div
                        className="queue-item-title truncate"
                        style={isCurrentlyPlaying ? { color: 'var(--accent)' } : undefined}
                      >
                        {qi.track.title || 'Unknown'}
                      </div>
                      <span className={`queue-source ${qi.source}`}>{qi.source}</span>
                    </div>
                    <div className="queue-item-artist truncate">
                      {qi.track.uploader || 'Unknown'}
                    </div>
                  </div>
                  {qi.track.duration && (
                    <span className="queue-item-dur">{fmt(qi.track.duration)}</span>
                  )}
                  <button
                    className="ib ib-sm"
                    style={{ opacity: 0, transition: 'opacity 150ms', flexShrink: 0 }}
                    onClick={e => { e.stopPropagation(); onRemove(i); }}
                    title="Remove from queue"
                    aria-label={`Remove ${qi.track.title} from queue`}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Stitch ghost-pill clear button */}
        {hasQueue && (
          <div style={{ padding: 'var(--sp-3) var(--sp-2)', display: 'flex', justifyContent: 'center' }}>
            <button
              id="queue-clear-btn"
              className="queue-clear-btn"
              onClick={onClear}
              aria-label="Clear queue"
            >
              Clear Queue
            </button>
          </div>
        )}

        {/* Empty state */}
        {!currentTrack && !hasQueue && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'var(--sp-9) var(--sp-4)',
              gap: 'var(--sp-3)',
              color: 'var(--text-3)',
              textAlign: 'center',
            }}
            role="status"
          >
            <List size={32} strokeWidth={1.2} />
            <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text-2)' }}>Queue is empty</div>
            <div style={{ fontSize: 'var(--fs-sm)' }}>
              Search for music and add songs to your queue.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
