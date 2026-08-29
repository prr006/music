import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1,
  Volume2, Volume1, VolumeX,
  List, Heart,
} from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';
import type { Track } from '../../shared/types';

// ─── Helpers ──────────────────────────────────────────────────────────────

function thumbHq(id: string) { return `https://img.youtube.com/vi/${id}/maxresdefault.jpg`; }
function thumbMq(id: string) { return `https://img.youtube.com/vi/${id}/mqdefault.jpg`; }

function fmt(s: number): string {
  if (!s || !Number.isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

// ─── Progress Bar ──────────────────────────────────────────────────────────

interface ProgressBarProps {
  position: number;
  duration: number;
  onSeekTo: (pos: number) => void;
}

function ProgressBar({ position, duration, onSeekTo }: ProgressBarProps) {
  const [dragging, setDragging] = useState(false);
  const [dragPct, setDragPct] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const pct = duration > 0 ? Math.min(1, position / duration) * 100 : 0;
  const displayPct = dragging ? dragPct * 100 : pct;

  const getPct = useCallback((e: MouseEvent | React.MouseEvent) => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const pct0 = getPct(e);
    setDragging(true);
    setDragPct(pct0);

    const onMove = (ev: MouseEvent) => setDragPct(getPct(ev));
    const onUp   = (ev: MouseEvent) => {
      const final = getPct(ev);
      onSeekTo(final * duration);
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  }, [getPct, onSeekTo, duration]);

  return (
    <div className="progress-wrap">
      <div
        ref={trackRef}
        className={`progress-track${dragging ? ' dragging' : ''}`}
        onMouseDown={handleMouseDown}
        role="slider"
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)}
      >
        <div className="progress-fill" style={{ width: `${displayPct}%` }} />
      </div>
      <div className="progress-times">
        <span>{fmt(dragging ? dragPct * duration : position)}</span>
        <span>{fmt(duration)}</span>
      </div>
    </div>
  );
}

// ─── Volume Control ────────────────────────────────────────────────────────

interface VolumeControlProps {
  volume: number;
  muted: boolean;
  onSetVolume: (v: number) => void;
  onToggleMute: () => void;
}

function VolumeControl({ volume, muted, onSetVolume, onToggleMute }: VolumeControlProps) {
  const VI = muted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;
  return (
    <div className="vol-wrap">
      <button
        className="ib ib-sm"
        onClick={onToggleMute}
        title={muted ? 'Unmute' : 'Mute'}
        aria-label={muted ? 'Unmute' : 'Mute'}
      >
        <VI size={14} />
      </button>
      <input
        type="range"
        className="vol-slider"
        min={0}
        max={100}
        value={muted ? 0 : volume}
        onChange={e => onSetVolume(Number(e.target.value))}
        aria-label="Volume"
      />
    </div>
  );
}

// ─── EQ Bars ───────────────────────────────────────────────────────────────

function EqBars() {
  return (
    <div className="eq" aria-hidden="true">
      <div className="eq-bar" />
      <div className="eq-bar" />
      <div className="eq-bar" />
    </div>
  );
}

// ─── Artwork Stage ─────────────────────────────────────────────────────────

interface ArtworkStageProps {
  state: PlayerState;
  onTogglePause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeekTo: (pos: number) => void;
  onSetVolume: (v: number) => void;
  onToggleMute: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleFavorite: (track?: Track) => void;
  onOpenQueue: () => void;
}

export function ArtworkStage({
  state,
  onTogglePause,
  onNext,
  onPrevious,
  onSeekTo,
  onSetVolume,
  onToggleMute,
  onToggleShuffle,
  onCycleRepeat,
  onToggleFavorite,
  onOpenQueue,
}: ArtworkStageProps) {
  const {
    currentTrack, playing, loading, position, duration,
    shuffle, repeat, volume, muted, favorites,
  } = state;

  const isFavorited = !!currentTrack && favorites.some(f => f.id === currentTrack.id);

  const [imgLoaded, setImgLoaded] = useState(false);
  const [artworkSrc, setArtworkSrc] = useState<string>('');
  // For crossfade: keep previous image visible while new one loads
  const [prevSrc, setPrevSrc] = useState<string>('');
  const [crossfading, setCrossfading] = useState(false);
  const prevTrackId = useRef<string | null>(null);

  // Track changes → initiate crossfade
  useEffect(() => {
    if (!currentTrack) return;
    if (currentTrack.id !== prevTrackId.current) {
      if (artworkSrc) {
        setPrevSrc(artworkSrc);
        setCrossfading(true);
      }
      setImgLoaded(false);
      setArtworkSrc(thumbHq(currentTrack.id));
      prevTrackId.current = currentTrack.id;
    }
  }, [currentTrack?.id]);

  const handleImgLoad = useCallback(() => {
    setImgLoaded(true);
    // Give the new image a moment to render, then fade out the old one
    setTimeout(() => {
      setCrossfading(false);
      setPrevSrc('');
    }, 60);
  }, []);

  const handleImgError = useCallback(() => {
    if (artworkSrc.includes('maxresdefault') && currentTrack) {
      setArtworkSrc(thumbMq(currentTrack.id));
    }
  }, [artworkSrc, currentTrack]);

  const RI = repeat === 'one' ? Repeat1 : Repeat;

  if (!currentTrack) return null;

  const trackId = currentTrack.id;

  return (
    <div className="artwork-stage" role="main" aria-label="Now playing">

      {/* ── Ambient background — multi-layer ─────────────────────────── */}
      <div className="ambient" aria-hidden="true">
        {/* Primary ambient: blurred artwork bleed */}
        {imgLoaded && (
          <img
            src={artworkSrc}
            alt=""
            className={`ambient-img visible`}
          />
        )}
        {/* Vignette for depth */}
        <div className="ambient-vignette" />
      </div>

      {/* ── Artwork ──────────────────────────────────────────────────── */}
      <div className="artwork-frame">
        <button
          type="button"
          className={[
            'artwork-img-wrap',
            playing ? 'playing' : 'paused',
            loading ? 'loading' : '',
          ].filter(Boolean).join(' ')}
          onClick={onTogglePause}
          aria-label={`${playing ? 'Pause' : 'Play'} ${currentTrack.title}`}
        >
          {/* Crossfade: previous image fades out as new one fades in */}
          {crossfading && prevSrc && (
            <img
              src={prevSrc}
              alt=""
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                opacity: imgLoaded ? 0 : 1,
                transition: 'opacity 0.4s ease',
                zIndex: 2,
                borderRadius: 'inherit',
              }}
            />
          )}

          {/* Shimmer placeholder */}
          {!imgLoaded && (
            <div
              className="skel artwork-placeholder"
              style={{ borderRadius: 'inherit' }}
            />
          )}

          {/* Main artwork image */}
          <img
            key={trackId}
            src={artworkSrc || thumbHq(trackId)}
            alt={currentTrack.title}
            className={`artwork-img${imgLoaded ? '' : ' fading'}`}
            onLoad={handleImgLoad}
            onError={handleImgError}
            style={{ zIndex: 1, position: 'relative' }}
          />

          {/* Loading overlay */}
          <div className={`artwork-loading-overlay${loading ? ' visible' : ''}`}>
            <div className="spin-lg" />
          </div>

          {/* Stitch: hover play/pause overlay */}
          {!loading && (
            <div className="artwork-hover-overlay" aria-hidden="true">
              {playing
                ? <Pause size={36} fill="white" color="white" />
                : <Play  size={36} fill="white" color="white" style={{ marginLeft: 4 }} />
              }
            </div>
          )}
        </button>
      </div>

      {/* ── Track Metadata ────────────────────────────────────────────── */}
      <div className="now-playing-content">
        <div className="track-meta">
        <div
          className="track-title"
          title={currentTrack.title}
        >
          {loading && !currentTrack.title ? 'Loading…' : (currentTrack.title || 'Unknown Track')}
        </div>
        <div className="track-artist" title={currentTrack.uploader}>
          {currentTrack.uploader || 'Unknown Artist'}
        </div>
        {currentTrack.album && (
          <div className="track-album" title={currentTrack.album}>
            {currentTrack.album}
          </div>
        )}
        </div>

      {/* ── Progress ──────────────────────────────────────────────────── */}
        <ProgressBar
          position={position}
          duration={duration}
          onSeekTo={onSeekTo}
        />

      {/* ── Playback Controls ─────────────────────────────────────────── */}
        <div className="playback-controls" role="toolbar" aria-label="Playback controls">
        <button
          className={`ib ${shuffle ? 'active' : 'dim'}`}
          onClick={onToggleShuffle}
          title="Shuffle"
          aria-label={`Shuffle ${shuffle ? 'on' : 'off'}`}
          aria-pressed={shuffle}
          id="btn-shuffle"
        >
          <Shuffle size={15} />
        </button>

          <div className="transport-main">
            <button
              className="ib"
              onClick={onPrevious}
              title="Previous"
              aria-label="Previous track"
              id="btn-previous"
            >
              <SkipBack size={18} fill="currentColor" />
            </button>

            <button
              className="play-btn"
              onClick={onTogglePause}
              disabled={loading}
              title={playing ? 'Pause' : 'Play'}
              aria-label={playing ? 'Pause' : 'Play'}
              id="btn-play-pause"
            >
              {loading
                ? <div className="spin-md" />
                : playing
                  ? <Pause size={26} fill="currentColor" />
                  : <Play  size={26} fill="currentColor" style={{ marginLeft: 3 }} />
              }
            </button>

            <button
              className="ib"
              onClick={onNext}
              title="Next"
              aria-label="Next track"
              id="btn-next"
            >
              <SkipForward size={18} fill="currentColor" />
            </button>
          </div>

        <button
          className={`ib ${repeat !== 'off' ? 'active' : 'dim'}`}
          onClick={onCycleRepeat}
          title={`Repeat: ${repeat}`}
          aria-label={`Repeat mode: ${repeat}`}
          id="btn-repeat"
        >
          <RI size={15} />
        </button>
        </div>

      {/* ── Secondary Controls ────────────────────────────────────────── */}
        <div className="secondary-controls">
        <VolumeControl
          volume={volume}
          muted={muted}
          onSetVolume={onSetVolume}
          onToggleMute={onToggleMute}
        />

        <div className="extras-wrap">
          {playing && <EqBars />}
          <button
            className={`ib ib-sm${isFavorited ? ' active fav-active' : ''}`}
            onClick={() => onToggleFavorite()}
            title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={isFavorited}
            id="btn-favorite"
          >
            <Heart size={15} fill={isFavorited ? 'currentColor' : 'none'} />
          </button>
          <button
            className="ib ib-sm"
            onClick={onOpenQueue}
            title="Queue"
            aria-label="Open queue"
            id="btn-open-queue"
            style={{ marginLeft: 4 }}
          >
            <List size={15} />
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
