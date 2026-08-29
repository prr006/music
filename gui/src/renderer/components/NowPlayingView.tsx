import { useState, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX, Volume1 } from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';

interface B { togglePause(): void; nextTrack(): void; previousTrack(): void; seekTo(p: number): void; setVolume(v: number): void; toggleMute(): void; toggleShuffle(): void; cycleRepeat(): void; }

function thumb(id: string) { return `https://img.youtube.com/vi/${id}/mqdefault.jpg`; }
function thumbMax(id: string) { return `https://img.youtube.com/vi/${id}/maxresdefault.jpg`; }
function fmt(s: number) { return (!s || !Number.isFinite(s)) ? '0:00' : `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`; }

export function NowPlayingView({ state, b }: { state: PlayerState; b: B }) {
  const { currentTrack, playing, loading, position, duration, shuffle, repeat, volume, muted } = state;
  const pct = duration > 0 ? (position / duration) * 100 : 0;
  const [drag, setDrag] = useState(false);
  const [dp, setDp] = useState(0);

  const seek = useCallback((e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    b.seekTo(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration);
  }, [b, duration]);

  const down = useCallback((e: React.MouseEvent) => {
    setDrag(true);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
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

  if (!currentTrack) {
    return (
      <div className="empty" style={{ height: '100%' }}>
        <div className="empty-icon"><svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
        <div className="empty-h">Nothing playing yet</div>
        <div className="empty-p">Search for a song to get started</div>
      </div>
    );
  }

  return (
    <div className="np">
      <div className="np-art" key={currentTrack.id}>
        <img src={thumbMax(currentTrack.id)} alt={currentTrack.title} onError={e => { (e.target as HTMLImageElement).src = thumb(currentTrack.id); }} />
        {loading && <div className="np-art-spin"><div className="spin spin-l" /></div>}
      </div>

      <div className="np-meta">
        <div className="np-title">{loading && !currentTrack.title ? 'Loading...' : (currentTrack.title || 'Unknown')}</div>
        <div className="np-artist">{currentTrack.uploader || 'Unknown artist'}</div>
      </div>

      <div className="np-progress">
        <div className="prog">
          <span className="prog-time">{fmt(drag ? dp * duration : position)}</span>
          <div className="prog-track" onClick={seek} onMouseDown={down}>
            <div className={`prog-fill ${drag ? 'drag' : ''}`} style={{ width: `${drag ? dp * 100 : pct}%`, transition: drag ? 'none' : undefined }} />
          </div>
          <span className="prog-time">{fmt(duration)}</span>
        </div>
      </div>

      <div className="np-controls">
        <button className={`ib ${shuffle ? 'on' : 'dim'}`} onClick={b.toggleShuffle} title="Shuffle"><Shuffle size={18} /></button>
        <button className="ib" onClick={b.previousTrack} title="Previous"><SkipBack size={20} fill="currentColor" /></button>
        <button className="play-btn play-btn-lg" onClick={b.togglePause} disabled={loading} title={playing ? 'Pause' : 'Play'}>
          {loading ? <div className="spin spin-m" style={{ borderColor: 'var(--c-surface-3)', borderTopColor: 'var(--c-text)' }} />
          : playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" style={{ marginLeft: 3 }} />}
        </button>
        <button className="ib" onClick={b.nextTrack} title="Next"><SkipForward size={20} fill="currentColor" /></button>
        <button className={`ib ${repeat !== 'off' ? 'on' : 'dim'}`} onClick={b.cycleRepeat} title={`Repeat: ${repeat}`}><RI size={18} /></button>
      </div>

      <div className="np-vol">
        <button className="ib ib-sm" onClick={b.toggleMute} title={muted ? 'Unmute' : 'Mute'}><VI size={16} /></button>
        <input type="range" min={0} max={100} value={muted ? 0 : volume} onChange={e => b.setVolume(Number(e.target.value))} style={{ width: 120 }} />
      </div>
    </div>
  );
}
