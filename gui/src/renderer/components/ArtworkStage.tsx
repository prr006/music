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
  const [imgLoaded, setImgLoaded] = useState(false);
  const [src, setSrc] = useState('');
  const prevId = useRef<string | null>(null);

  useEffect(() => {
    if (!track) {
      setSrc('');
      setImgLoaded(false);
      prevId.current = null;
      return;
    }
    if (track.id !== prevId.current) {
      setImgLoaded(false);
      setSrc(artworkFor(track, true));
      prevId.current = track.id;
    }
  }, [track?.id]);

  const handleError = useCallback(() => {
    if (track && src.includes('maxresdefault')) {
      setSrc(thumbMq(track.id));
    }
  }, [src, track]);

  if (!track) return null;

  return (
    <div className="vinyl-stage" aria-hidden="true">
      <div className={`vinyl-disc${playing ? ' spinning' : ''}`}>
        <div className="vinyl-label" />
      </div>
      <button
        type="button"
        className={[
          'artwork-tile',
          playing ? 'playing' : 'paused',
          loading ? 'loading' : '',
        ].filter(Boolean).join(' ')}
        onClick={onTogglePause}
        aria-label={`${playing ? 'Pause' : 'Play'} ${track.title}`}
      >
        {!imgLoaded && <div className="skel artwork-placeholder" />}
        {src && (
          <img
            key={track.id}
            src={src}
            alt={track.title}
            className={`artwork-img${imgLoaded ? '' : ' fading'}`}
            onLoad={() => setImgLoaded(true)}
            onError={handleError}
          />
        )}
        {loading && (
          <div className="artwork-loading-overlay visible">
            <div className="spin-lg" />
          </div>
        )}
      </button>
    </div>
  );
}
