import { useState, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, ListMusic, Volume2, VolumeX, Volume1 } from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';

interface B { togglePause(): void; nextTrack(): void; previousTrack(): void; seekTo(p: number): void; setVolume(v: number): void; toggleMute(): void; toggleShuffle(): void; cycleRepeat(): void; }

function thumb(id: string) { return `https://img.youtube.com/vi/${id}/mqdefault.jpg`; }
function fmt(s: number) { return (!s || !Number.isFinite(s)) ? '0:00' : `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`; }

export function PlayerBar({ state, b, onNP, onQ }: { state: PlayerState; b: B; onNP: () => void; onQ: () => void }) {
  const { currentTrack, playing, loading, position, duration, volume, muted, shuffle, repeat } = state;
  const pct = duration > 0 ? (position / duration) * 100 : 0;
  const [drag, setDrag] = useState(false);
  const [dp, setDp] = useState(0);

  const click = useCallback((e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    b.seekTo(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration);
  }, [b, duration]);

  const down = useCallback((e: React.MouseEvent) => {
    setDrag(true);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDp(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
    const mv = (ev: MouseEvent) => setDp(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)));
    const up = (ev: MouseEvent) => {
      b.seekTo(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * duration);
      setDrag(false);
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  }, [b, duration]);

  const VI = muted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;
  const RI = repeat === 'one' ? Repeat1 : Repeat;

  return (
    <div className="bar">
      <div className="bar-left" onClick={onNP}>
        {currentTrack ? (
          <>
            <img src={thumb(currentTrack.id)} alt="" className="bar-art" />
            <div className="bar-info">
              <div className="bar-track">{loading ? 'Loading...' : (currentTrack.title || 'Unknown')}</div>
              <div className="bar-artist">{currentTrack.uploader || ''}</div>
            </div>
          </>
        ) : <div style={{ width: '100%', textAlign: 'center', fontSize: 12, color: 'var(--c-text-3)' }}>No track playing</div>}
      </div>

      <div className="bar-center">
        <div className="bar-controls">
          <button className={`ib ib-sm ${shuffle ? 'on' : 'dim'}`} onClick={b.toggleShuffle} title="Shuffle"><Shuffle size={14} /></button>
          <button className="ib ib-sm" onClick={b.previousTrack} title="Previous"><SkipBack size={14} fill="currentColor" /></button>
          <button className="play-btn play-btn-sm" onClick={b.togglePause} disabled={loading} title={playing ? 'Pause' : 'Play'}>
            {loading ? <div className="spin spin-s" style={{ borderColor: 'var(--c-surface-3)', borderTopColor: 'var(--c-text)' }} />
            : playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" style={{ marginLeft: 1 }} />}
          </button>
          <button className="ib ib-sm" onClick={b.nextTrack} title="Next"><SkipForward size={14} fill="currentColor" /></button>
          <button className={`ib ib-sm ${repeat !== 'off' ? 'on' : 'dim'}`} onClick={b.cycleRepeat} title={`Repeat: ${repeat}`}><RI size={14} /></button>
        </div>
        <div className="prog">
          <span className="prog-time" style={{ minWidth: 32 }}>{fmt(drag ? dp * duration : position)}</span>
          <div className="prog-track" style={{ flex: 1 }} onClick={click} onMouseDown={down}>
            <div className={`prog-fill ${drag ? 'drag' : ''}`} style={{ width: `${drag ? dp * 100 : pct}%`, transition: drag ? 'none' : undefined }} />
          </div>
          <span className="prog-time" style={{ minWidth: 32 }}>{fmt(duration)}</span>
        </div>
      </div>

      <div className="bar-right">
        <button className="ib ib-sm" onClick={onQ} title="Queue"><ListMusic size={14} /></button>
        <button className="ib ib-sm" onClick={b.toggleMute} title={muted ? 'Unmute' : 'Mute'}><VI size={14} /></button>
        <input type="range" min={0} max={100} value={muted ? 0 : volume} onChange={e => b.setVolume(Number(e.target.value))} style={{ width: 80 }} />
      </div>
    </div>
  );
}
