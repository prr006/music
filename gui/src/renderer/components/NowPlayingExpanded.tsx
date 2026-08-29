import React from 'react';
import type { PlayerState } from '../hooks/useBackend';
import type { Track } from '../../shared/types';

interface NowPlayingExpandedProps {
  state: PlayerState;
  onPlay: (t: Track) => void;
  onTogglePause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (pct: number) => void;
  onSetVolume?: (v: number) => void;
  onToggleMute?: () => void;
  onToggleShuffle?: () => void;
  onCycleRepeat?: () => void;
  onQueue: () => void;
}

export function NowPlayingExpanded({ state, onPlay, onTogglePause, onNext, onPrevious, onSeek, onSetVolume, onToggleMute, onToggleShuffle, onCycleRepeat, onQueue }: NowPlayingExpandedProps) {
  const { currentTrack, playing, loading, position, duration, shuffle, repeat, volume, muted } = state;
  const fmt = (s?: number) => s ? `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}` : '';

const nowTitleStyle = { fontSize: 28, fontWeight: 700, letterSpacing: -0.3, color: 'var(--yt-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 as const };
const nowArtistStyle = { fontSize: 14, color: 'var(--yt-text-2)', marginTop: 4 as const };
  const nowProgFillStyle = { height: '100%', background: 'var(--yt-accent)', borderRadius: 3 };
  const nowProgTimeStyle = { fontSize: 11, color: 'var(--yt-text-3)', margin: '0 4px', minWidth: 40, textAlign: 'center' as const };

  return (
    <div className="nowplaying-view">
      {/* Expanded artwork */}
      <div className="now-artwork" style={{ width: '100%', maxWidth: 420, aspectRatio: 1, borderRadius: 8, overflow: 'hidden', background: 'var(--yt-surface-3)', boxShadow: '0 20px 64px rgba(0,0,0,0.25)' }}>
        {currentTrack ? (
          <img
            src={`https://img.youtube.com/vi/${currentTrack.id}/maxresdefault.jpg`}
            alt={currentTrack.title || 'Now playing'}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--yt-text-3)' }}>—</div>
        )}
      </div>

      {/* Metadata */}
      <div className="now-meta-expanded" style={{ textAlign: 'center', width: '100%', maxWidth: 560 }}>
        {currentTrack && (
          <div className="now-title-expanded" style={nowTitleStyle}>{currentTrack.title || 'Unknown'}</div>
        )}
        {currentTrack && (
          <div className="now-artist-expanded" style={nowArtistStyle}>{currentTrack.uploader || 'Unknown artist'}</div>
        )}
        {currentTrack?.album && (
          <div style={{ fontSize: 12, color: 'var(--yt-text-2)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentTrack.album}</div>
        )}
      </div>

      {/* Controls */}
      <div className="now-controls" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, marginTop: 24, flexWrap: 'wrap' }}>
        <button className="exp-control prev" onClick={(e) => { e.stopPropagation(); onPrevious(); }} title="Previous" style={{ flexShrink: 0 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 10 12 15 6"></polyline></svg>
        </button>
        <button className="exp-control play-pause" onClick={(e) => { e.stopPropagation(); onTogglePause(); }} title={playing ? 'Pause' : 'Play'} style={{ flexShrink: 0, minWidth: 44 }}>
          {playing ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="6 9 12 15 18 9"></polyline></svg>
          )}
        </button>
        <button className="exp-control next" onClick={(e) => { e.stopPropagation(); onNext(); }} title="Next" style={{ flexShrink: 0 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {onToggleShuffle && (
            <button className="exp-control shuffle" onClick={(e) => { e.stopPropagation(); onToggleShuffle(); }} title={shuffle ? 'Shuffle on' : 'Shuffle off'}>↺</button>
          )}
          {onCycleRepeat && (
            <button className="exp-control repeat" onClick={(e) => { e.stopPropagation(); onCycleRepeat(); }} title={repeat !== 'off' ? `Repeat: ${repeat}` : 'Repeat off'}>•••</button>
          )}
        </div>

        <button className="exp-control vol" title="Volume" style={{ flexShrink: 0 }}>🔊</button>
      </div>

      {/* Progress */}
      <div className="now-prog" style={{ width: '100%', maxWidth: 560, margin: 'var(--yt-spacing-4) 0' }}>
        <div className="now-prog-track" style={{ height: 6, background: 'var(--yt-surface-3)', borderRadius: 3, cursor: 'pointer' }}>
          <div className="now-prog-fill" style={nowProgFillStyle} />
          <span className="now-prog-time" style={nowProgTimeStyle}>{fmt(position)}</span>
          <span className="now-prog-time" style={nowProgTimeStyle}>{fmt(duration)}</span>
        </div>
      </div>

      {/* Queue button */}
      <button className="now-queue" style={{ marginTop: 16, padding: 'var(--yt-spacing-2) var(--yt-spacing-4)', fontSize: 13, fontWeight: 500, color: 'var(--yt-accent)', border: '1px solid var(--yt-accent)', borderRadius: 8, background: 'var(--yt-accent-bg)', cursor: 'pointer', width: 'fit-content' }} onClick={(e) => { e.stopPropagation(); onQueue(); }}>
        View Queue
      </button>
    </div>
  );
}