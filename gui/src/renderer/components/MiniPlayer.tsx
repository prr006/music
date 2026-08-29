import React from 'react';
import type { PlayerState } from '../hooks/useBackend';
import type { Track } from '../../shared/types';

interface MiniPlayerProps {
  expansion: 'compact' | 'expanded';
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
}

export function MiniPlayer({ expansion, state, onPlay, onTogglePause, onNext, onPrevious, onSeek, onSetVolume, onToggleMute, onToggleShuffle, onCycleRepeat }: MiniPlayerProps) {
  const { currentTrack, playing, loading, position, duration, shuffle, repeat, volume, muted } = state;
  const fmt = (s?: number) => s ? `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}` : '';

  return (
    <div className="mini-player" style={{
      width: '100%', maxWidth: 420, marginTop: 12,
      background: 'var(--yt-player-bg)', borderTop: '1px solid var(--yt-player-border)',
      padding: 'var(--yt-spacing-4) var(--yt-spacing-4)', borderRadius: '0 0 var(--yt-radius-lg) var(--yt-radius-lg)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--yt-spacing-4)'
    }}>
      {/* Left: artwork + info */}
      <div className="mini-left" style={{ display: 'flex', alignItems: 'center', gap: 'var(--yt-spacing-3)', flex: 1, minWidth: 0 }}>
        {currentTrack && (
          <img
            src={currentTrack.url.includes('youtube.com') ? currentTrack.url.replace('watch?v=', 'img.youtube.com/vi/') + '/mqdefault.jpg' : 'https://img.youtube.com/vi/' + currentTrack.id + '/mqdefault.jpg'}
            alt={currentTrack.title || 'Now playing'}
            className="mini-art"
            style={{ width: 40, height: 40, borderRadius: 4, objectFit: 'cover', background: 'var(--yt-surface-3)', flexShrink: 0 }}
          />
        )}
        {!currentTrack && (
          <div style={{ width: 40, height: 40, borderRadius: 4, background: 'var(--yt-surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--yt-text-3)' }}>?</div>
        )}
        {currentTrack && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mini-title" style={{ fontSize: 12, fontWeight: 500, color: 'var(--yt-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentTrack.title || 'Unknown'}</div>
            <div className="mini-artist" style={{ fontSize: 10, color: 'var(--yt-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentTrack.uploader || 'Unknown artist'}</div>
          </div>
        )}
      </div>

      {/* Center: progress */}
      <div className="mini-center" style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
        <span className="mini-prog">{fmt(position)}</span>
        <span className="mini-prog">{fmt(duration)}</span>
      </div>

      {/* Right: essential controls */}
      <div className="mini-right">
        <button className="mini-control prev" onClick={(e) => { e.stopPropagation(); onPrevious(); }} title="Prev">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 10 12 15 6"></polyline></svg>
        </button>
        <button className="mini-control play-pause" onClick={(e) => { e.stopPropagation(); onTogglePause(); }} title={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="6 9 12 15 18 9"></polyline></svg>
          )}
        </button>
        <button className="mini-control next" onClick={(e) => { e.stopPropagation(); onNext(); }} title="Next">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
        {onSetVolume && (
          <div className="mini-vol" style={{ display: 'flex', alignItems: 'center', gap: 'var(--yt-spacing-xs)' }}>
            <input
              type="range"
              min={0}
              max={100}
              value={muted ? 0 : volume}
              onChange={(e) => onSetVolume(Number((e.currentTarget as HTMLInputElement).value))}
              style={{ width: 60, height: 20 }}
            />
            <span className="mini-vol-val" style={{ fontSize: 10, color: 'var(--yt-text-2)' }}>{volume}%</span>
          </div>
        )}
        {onToggleMute && (
          <button className="mini-control mute" onClick={(e) => { e.stopPropagation(); onToggleMute(); }} title={muted ? 'Unmute' : 'Mute'}>
            {muted ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="3" y1="3" x2="21" y2="21"/><line x1="3" y1="21" x2="21" y2="3"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="18" x2="21" y2="18"/></svg>
            )}
          </button>
        )}
        {onToggleShuffle && (
          <button className="mini-control shuffle" onClick={(e) => { e.stopPropagation(); onToggleShuffle(); }} title={shuffle ? 'Shuffle on' : 'Shuffle off'}>
            {shuffle ? '<>' : 'Shuffle'}
          </button>
        )}
        {onCycleRepeat && (
          <button className="mini-control repeat" onClick={(e) => { e.stopPropagation(); onCycleRepeat(); }} title="Repeat">
            {repeat}
          </button>
        )}
      </div>
    </div>
  );
}