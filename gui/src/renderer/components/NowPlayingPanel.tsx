import { useState, useCallback, useRef, useLayoutEffect } from 'react';
import {
  Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1,
  Volume2, VolumeX, Heart, Plus, List, Sun, Moon, Monitor,
} from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';
import type { Theme } from '../types';
import type { Track } from '../../shared/types';
import { fmt, fmtRemaining } from '../lib/media';

interface NowPlayingPanelProps {
  state: PlayerState;
  theme: Theme;
  queueOpen: boolean;
  onTogglePause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeekTo: (pos: number) => void;
  onSetVolume: (v: number) => void;
  onToggleMute: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleFavorite: (track?: Track) => void;
  onAddToQueue: (track: Track) => void;
  onToggleQueue: () => void;
  onCycleTheme: () => void;
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'light') return <Sun size={16} strokeWidth={1.6} />;
  if (theme === 'dark') return <Moon size={16} strokeWidth={1.6} />;
  return <Monitor size={16} strokeWidth={1.6} />;
}

function FitTitle({ text }: { text: string }) {
  const ref = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      el.style.fontSize = '';
      let size = parseFloat(getComputedStyle(el).fontSize);
      const min = 16;
      while (el.scrollHeight > el.clientHeight + 1 && size > min) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  return (
    <h1 ref={ref} className="np-title" title={text}>{text}</h1>
  );
}

function ProgressBar({
  position, duration, onSeekTo, disabled,
}: { position: number; duration: number; onSeekTo: (pos: number) => void; disabled?: boolean }) {
  const [dragging, setDragging] = useState(false);
  const [dragPct, setDragPct] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const pct = duration > 0 ? Math.min(1, position / duration) : 0;
  const displayPct = dragging ? dragPct : pct;

  const getPct = useCallback((e: MouseEvent | React.MouseEvent) => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    const pct0 = getPct(e);
    setDragging(true);
    setDragPct(pct0);
    const onMove = (ev: MouseEvent) => setDragPct(getPct(ev));
    const onUp = (ev: MouseEvent) => {
      onSeekTo(getPct(ev) * duration);
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [getPct, onSeekTo, duration, disabled]);

  return (
    <div className="np-progress">
      <div
        ref={trackRef}
        className={`np-track${dragging ? ' dragging' : ''}${disabled ? ' disabled' : ''}`}
        onMouseDown={handleMouseDown}
        role="slider"
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)}
      >
        <div className="np-fill" style={{ width: `${displayPct * 100}%` }} />
      </div>
      <div className="np-times">
        <span>{fmt(dragging ? dragPct * duration : position)}</span>
        <span>{fmtRemaining(dragging ? dragPct * duration : position, duration)}</span>
      </div>
    </div>
  );
}

export function NowPlayingPanel({
  state, theme, queueOpen,
  onTogglePause, onNext, onPrevious, onSeekTo,
  onSetVolume, onToggleMute, onToggleShuffle, onCycleRepeat,
  onToggleFavorite, onAddToQueue, onToggleQueue, onCycleTheme,
}: NowPlayingPanelProps) {
  const {
    currentTrack, playing, loading, position, duration,
    shuffle, repeat, volume, muted, favorites,
  } = state;

  const isFavorited = !!currentTrack && favorites.some(f => f.id === currentTrack.id);
  const RI = repeat === 'one' ? Repeat1 : Repeat;
  const idle = !currentTrack;

  return (
    <aside className="np-panel player-dock" aria-label="Now playing">
      <div className="np-toolbar">
        <button
          className="ghost-btn"
          onClick={onCycleTheme}
          title={`Theme: ${theme}`}
          aria-label={`Theme: ${theme}. Click to cycle.`}
          id="btn-theme"
        >
          <ThemeIcon theme={theme} />
        </button>
        <button
          className={`ghost-btn${queueOpen ? ' active' : ''}`}
          onClick={onToggleQueue}
          title="Queue"
          aria-label="Toggle queue"
          aria-pressed={queueOpen}
          id="btn-open-queue"
        >
          <List size={16} strokeWidth={1.6} />
        </button>
      </div>

      <div className="np-body">
        <div className={`np-meta${loading ? ' is-resolving' : ''}`}>
        {currentTrack?.album && (
          <div className="np-album truncate" title={currentTrack.album}>{currentTrack.album}</div>
        )}
        <FitTitle text={idle ? 'Nothing playing' : (currentTrack?.title || 'Unknown Track')} />
        <div className="np-artist-row">
          <span className="np-artist truncate" title={idle ? undefined : (currentTrack?.uploader || undefined)}>
            {idle ? 'Search to start listening' : (currentTrack?.uploader || 'Unknown Artist')}
          </span>
          {!idle && (
            <div className="np-inline-actions">
              <button
                className={`ghost-btn${isFavorited ? ' fav' : ''}`}
                onClick={() => onToggleFavorite()}
                title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                aria-pressed={isFavorited}
                id="btn-favorite"
              >
                <Heart size={16} strokeWidth={1.6} fill={isFavorited ? 'currentColor' : 'none'} />
              </button>
              <button
                className="ghost-btn"
                onClick={() => currentTrack && onAddToQueue(currentTrack)}
                title="Add to queue"
                aria-label="Add current track to queue"
                id="btn-add-queue"
              >
                <Plus size={16} strokeWidth={1.6} />
              </button>
            </div>
          )}
        </div>
        </div>

        <ProgressBar
          position={position}
          duration={duration}
          onSeekTo={onSeekTo}
          disabled={idle || loading}
        />

        <div className="np-transport" role="toolbar" aria-label="Playback controls">
          <button
            className={`ghost-btn${shuffle ? ' on' : ''}`}
            onClick={onToggleShuffle}
            title="Shuffle"
            aria-label="Shuffle"
            aria-pressed={shuffle}
            id="btn-shuffle"
            disabled={idle}
          >
            <Shuffle size={16} />
          </button>
          <button
            className="ghost-btn"
            onClick={onPrevious}
            title="Previous"
            aria-label="Previous track"
            id="btn-previous"
            disabled={idle}
          >
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button
            className="play-btn"
            onClick={onTogglePause}
            disabled={idle || loading}
            title={playing ? 'Pause' : 'Play'}
            aria-label={playing ? 'Pause' : 'Play'}
            id="btn-play-pause"
          >
            {loading
              ? <div className="spin-sm play-loading" />
              : playing
                ? <Pause size={22} fill="currentColor" />
                : <Play size={22} fill="currentColor" style={{ marginLeft: 2 }} />
            }
          </button>
          <button
            className="ghost-btn"
            onClick={onNext}
            title="Next"
            aria-label="Next track"
            id="btn-next"
            disabled={idle}
          >
            <SkipForward size={18} fill="currentColor" />
          </button>
          <button
            className={`ghost-btn${repeat !== 'off' ? ' on' : ''}`}
            onClick={onCycleRepeat}
            title={`Repeat: ${repeat}`}
            aria-label={`Repeat mode: ${repeat}`}
            id="btn-repeat"
            disabled={idle}
          >
            <RI size={16} />
          </button>
        </div>

        <div className="np-volume">
          <button
            className="ghost-btn sm"
            onClick={onToggleMute}
            title={muted ? 'Unmute' : 'Mute'}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <input
            type="range"
            className="vol-slider"
            min={0}
            max={100}
            value={muted ? 0 : volume}
            onChange={e => onSetVolume(Number(e.target.value))}
            aria-label="Volume"
            style={{ ['--vol' as string]: `${muted ? 0 : volume}%` }}
          />
          <span className="vol-value">{muted ? 0 : Math.round(volume)}</span>
        </div>
      </div>

      <div className="np-footer">
        {playing && (
          <div className="eq" aria-hidden="true">
            <div className="eq-bar" />
            <div className="eq-bar" />
            <div className="eq-bar" />
            <div className="eq-bar" />
            <div className="eq-bar" />
          </div>
        )}
        {!playing && <span />}
        <span className="np-source">YouTube Music</span>
      </div>
    </aside>
  );
}
