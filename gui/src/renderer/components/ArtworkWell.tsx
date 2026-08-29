import React, { useState, useEffect, useCallback } from 'react';
import { useBackend } from '../hooks/useBackend';
import type { Track } from '../../shared/types';

export interface ArtworkWellProps {
  expansion: 'compact' | 'expanded';
  onExpandChange: (expansion: 'compact' | 'expanded') => void;
  state: import('../hooks/useBackend').PlayerState;
  onPlay: (track: Track) => void;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePause: () => void;
  onSeek: (pct: number) => void;
  onSetVolume: (volume: number) => void;
  onToggleMute: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
}

export function ArtworkWell({ expansion, onExpandChange, state, onPlay, onPrevious, onNext, onTogglePause, onSeek, onSetVolume, onToggleMute, onToggleShuffle, onCycleRepeat }: ArtworkWellProps) {
  const [seekPct, setSeekPct] = useState<number | null>(null);

  const fmt = (s?: number) => s ? `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}` : '';

  const handleArtworkClick = () => {
    if (state.currentTrack) {
      onPlay(state.currentTrack);
    }
  };

  return (
    <div className="artwork-well" style={{ width: 200, height: 200, flexShrink: 0 }} onClick={handleArtworkClick}>
      <div className="artwork-inner" style={{ width: '100%', height: '100%', position: 'relative' }}>
        {state.currentTrack && state.currentTrack.artwork && (
          <img
            src={state.currentTrack.artwork}
            alt={state.currentTrack.title || 'Now playing'}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}

        {!state.currentTrack && (
          <div style={{ width: '100%', height: '100%', background: 'var(--bg-elevated)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'var(--yt-text-2)' }}>No track</span>
          </div>
        )}

        <div
          className="prog-track"
          onClick={(e) => {
            const well = e.target as HTMLElement;
            const artwork = well.parentElement;
            if (artwork && artwork.classList.contains('artwork-well')) {
              const rect = artwork.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const pct = Math.max(0, Math.min(1, clickX / rect.width));
              setSeekPct(pct);
              onSeek(pct * (state.duration || 0));
            }
          }}
        >
          {state.currentTrack && (
            <div className="prog-bar" style={{ width: '100%', height: 4, background: 'var(--yt-text-3)', borderRadius: 2, position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
              {seekPct !== null && (
                <div className="prog-fill" style={{ width: `${seekPct * 100}%`, height: 4, background: 'var(--yt-text-3)', borderRadius: 2 }} />
              )}
              <span className="prog-time" style={{ fontSize: 11, color: 'var(--yt-text-3)', margin: '0 4px', minWidth: 36, textAlign: 'center' }}>{fmt(state.position)}</span>
              <span className="prog-time" style={{ fontSize: 11, color: 'var(--yt-text-3)', minWidth: 36, textAlign: 'center' }}>{fmt(state.duration)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}