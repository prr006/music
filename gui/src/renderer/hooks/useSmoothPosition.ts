import { useEffect, useRef, useState } from 'react';

/**
 * Smooth playback position for display.
 *
 * The backend position sample arrives at 2 Hz; rendering it directly makes
 * the progress bar and the lyric highlight jump in half-second steps. This
 * hook reads the backend's interpolated position (anchor + local clock, see
 * `useBackend.getPosition`) on every animation frame while playing, holds it
 * still while paused, and zeroes it while a track is loading or absent.
 */
export function useSmoothPosition(
  playing: boolean,
  loading: boolean,
  duration: number,
  getPosition: () => number,
): number {
  const [pos, setPos] = useState(0);
  const getRef = useRef(getPosition);
  getRef.current = getPosition;

  useEffect(() => {
    if (loading) {
      setPos(0);
      return;
    }
    if (!playing) {
      setPos(getRef.current());
      return;
    }
    let raf = 0;
    const loop = () => {
      const current = getRef.current();
      setPos(duration > 0 ? Math.min(current, duration) : current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, loading, duration]);

  return pos;
}
