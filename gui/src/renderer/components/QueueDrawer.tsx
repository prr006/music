import React from 'react';
import type { PlayerState } from '../hooks/useBackend';
import type { Track, QueueItem } from '../../shared/types';
import { ListMusic, Trash, SkipForward } from 'lucide-react';

interface QueueDrawerProps {
  state: PlayerState;
  onClear: () => void;
  onPlay: (t: Track) => void;
}

export function QueueDrawer({ state, onClear, onPlay }: QueueDrawerProps) {
  const { currentTrack, queue } = state;
  const fmt = (s?: number) => s ? `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}` : '';

  return (
    <div className="queue-drawer" onClick={(e) => e.stopPropagation()}>
      <div style={{ padding: 'var(--yt-spacing-4) var(--yt-spacing-4)' }}>
        {/* Now Playing section */}
        {currentTrack && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--yt-spacing-3)', marginBottom: 'var(--yt-spacing-3)', paddingBottom: 'var(--yt-spacing-3)', borderBottom: '1px solid var(--yt-border)' }}>
            <img
              src={currentTrack.url.includes('youtube.com') ? currentTrack.url.replace('watch?v=', 'img.youtube.com/vi/') + '/mcb.png' : 'https://img.youtube.com/vi/' + currentTrack.id + '/maxresdefault.jpg'}
              alt={currentTrack.title}
              className="now-art"
              style={{ width: 48, height: 48, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
            />
            <div className="now-info" style={{ flex: 1, minWidth: 0 }}>
              <div className="now-title" style={{ fontSize: 13, fontWeight: 500, color: 'var(--yt-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentTrack.title || 'Unknown'}</div>
              <div className="now-artist" style={{ fontSize: 11, color: 'var(--yt-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentTrack.uploader || 'Unknown artist'}</div>
            </div>
          </div>
        )}

        {/* Next Up section */}
        {queue.length > 0 && (
          <div style={{ marginTop: 'var(--yt-spacing-3)' }}>
            <div style={{ fontSize: 12, color: 'var(--yt-text-2)', marginBottom: 6 }}>Next Up</div>
            <div className="queue-list" style={{ maxHeight: 300, overflowY: 'auto' }}>
              {queue.map((qi: QueueItem, idx: number) => {
                const isPlaying = currentTrack?.id === qi.track.id;
                return (
                  <div key={`${qi.track.id}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--yt-spacing-3)', padding: 'var(--yt-spacing-xs) var(--yt-spacing-3)', borderRadius: 6, color: 'var(--yt-text)', cursor: 'pointer', transition: 'background 0.1s', marginBottom: 4 }} onMouseOver={() => {} } onMouseOut={() => {} } onClick={() => onPlay(qi.track)}>
                    <img
                      src={qi.track.url.includes('youtube.com') ? qi.track.url.replace('watch?v=', 'img.youtube.com/vi/') + '/mqdefault.jpg' : 'https://img.youtube.com/vi/' + qi.track.id + '/mqdefault.jpg'}
                      alt={qi.track.title}
                      className="queue-art"
                      style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
                    />
                    <div className="queue-info" style={{ flex: 1, minWidth: 0 }}>
                      <div className="queue-title" style={{ fontSize: 12, fontWeight: 500, color: isPlaying ? 'var(--yt-accent)' : 'var(--yt-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qi.track.title || 'Unknown'}</div>
                      <div className="queue-artist" style={{ fontSize: 10, color: 'var(--yt-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qi.track.uploader || 'Unknown'}</div>
                    </div>
                    {isPlaying && (
                      <span style={{ fontSize: 10, color: 'var(--yt-accent)', opacity: 1 }}>Now playing</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty queue */}
        {!currentTrack && queue.length === 0 && (
          <div style={{ padding: 'var(--yt-spacing-4) var(--yt-spacing-4)', textAlign: 'center', color: 'var(--yt-text-3)' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="18" x2="21" y2="18"/></svg>
            <div style={{ marginTop: 6 }}>Queue is empty</div>
            <div style={{ marginTop: 4 }}>Add songs from search to build your queue</div>
          </div>
        )}

        {/* Controls */}
        {currentTrack || queue.length > 0 && (
          <div style={{ marginTop: 'var(--yt-spacing-3)', paddingTop: 'var(--yt-spacing-3)', borderTop: '1px solid var(--yt-border)' }}>
            <button className="clear-queue" onClick={(e) => { e.stopPropagation(); onClear(); }} style={{ fontSize: 12, color: 'var(--yt-accent)', border: 'none', background: 'transparent', cursor: 'pointer' }}>Clear queue</button>
          </div>
        )}
      </div>
    </div>
  );
}