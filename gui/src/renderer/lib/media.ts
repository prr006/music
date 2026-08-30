import type { Track } from '../../shared/types';

export function thumbHq(id: string) {
  return `https://img.youtube.com/vi/${id}/maxresdefault.jpg`;
}

export function thumbMq(id: string) {
  return `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
}

export function artworkFor(track: Track | null | undefined, hq = false): string {
  if (!track) return '';
  if (track.artwork) return track.artwork;
  return hq ? thumbHq(track.id) : thumbMq(track.id);
}

export function fmt(s?: number): string {
  if (!s || !Number.isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

export function fmtRemaining(position: number, duration: number): string {
  if (!duration || !Number.isFinite(duration)) return '-0:00';
  return `-${fmt(Math.max(0, duration - position))}`;
}
