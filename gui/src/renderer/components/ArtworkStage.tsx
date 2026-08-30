import { useState, useCallback, useRef, useEffect } from 'react';
import type { Track } from '../../shared/types';
import { artworkFor, thumbMq } from '../lib/media';

interface ArtworkStageProps {
  track: Track | null;
  playing: boolean;
  loading: boolean;
  onTogglePause: () => void;
}

export function ArtworkStage({ track, playing, loading, onTogglePause }: ArtworkStageProps) {
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [frontReady, setFrontReady] = useState(false);
  const frontRef = useRef('');
  const wantId = useRef<string | null>(null);

  useEffect(() => {
    if (!track) {
      wantId.current = null;
      frontRef.current = '';
      setFrontReady(false);
      setFront('');
      setBack('');
      return;
    }

    const id = track.id;
    wantId.current = id;
    const nextSrc = artworkFor(track, true);

    const apply = (src: string) => {
      if (wantId.current !== id) return;
      const previous = frontRef.current;
      setBack(previous && previous !== src ? previous : '');
      setFront(src);
      frontRef.current = src;
      setFrontReady(true);
    };

    const load = (src: string, allowFallback: boolean) => {
      const img = new Image();
      img.onload = () => apply(src);
      img.onerror = () => {
        if (wantId.current !== id) return;
        if (allowFallback) load(thumbMq(id), false);
        else apply(src);
      };
      img.src = src;
    };

    if (frontRef.current) setFrontReady(false);
    load(nextSrc, nextSrc.includes('maxresdefault'));
  }, [track?.id]);

  useEffect(() => {
    if (!frontReady || !back) return;
    const timer = window.setTimeout(() => setBack(''), 280);
    return () => window.clearTimeout(timer);
  }, [frontReady, back, front]);

  const handleError = useCallback(() => {
    if (track && front.includes('maxresdefault')) {
      const fallback = thumbMq(track.id);
      frontRef.current = fallback;
      setFront(fallback);
    }
  }, [front, track]);

  if (!track) return null;

  return (
    <div className="hero-stage">
      <button
        type="button"
        className={[
          'artwork-tile',
          playing ? 'playing' : 'paused',
          loading ? 'loading' : '',
          frontReady ? 'ready' : '',
        ].filter(Boolean).join(' ')}
        onClick={loading ? undefined : onTogglePause}
        disabled={loading}
        aria-label={`${playing ? 'Pause' : 'Play'} ${track.title}`}
      >
        {!front && !back && <div className="skel artwork-placeholder" />}
        {back && (
          <img src={back} alt="" className="artwork-img artwork-back" aria-hidden="true" />
        )}
        {front && (
          <img
            src={front}
            alt={track.title}
            className={`artwork-img${frontReady ? '' : ' fading'}`}
            onError={handleError}
          />
        )}
        <div className={`artwork-loading-overlay${loading ? ' visible' : ''}`} aria-hidden="true">
          <div className="artwork-loading-bar" />
        </div>
      </button>
    </div>
  );
}
