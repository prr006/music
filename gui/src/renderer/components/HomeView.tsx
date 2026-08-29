import { Play, Music } from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';
import type { Track, QueueItem } from '../../shared/types';

interface Props {
  state: PlayerState;
  onPlay: (t: Track) => void;
  onNavigate: (v: 'search' | 'queue') => void;
}

function thumb(id: string) { return `https://img.youtube.com/vi/${id}/mqdefault.jpg`; }

function greet() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HomeView({ state, onPlay, onNavigate }: Props) {
  const recent = state.history.slice(0, 10);
  const queued = state.queue.slice(0, 10);
  const has = recent.length > 0 || queued.length > 0;

  return (
    <div style={{ animation: 'fadeIn 0.3s' }}>
      <h1 className="h1">{greet()}</h1>

      {!has && (
        <div className="empty" style={{ paddingTop: 80 }}>
          <Music className="empty-icon" size={56} strokeWidth={1} />
          <div className="empty-h">Your music starts here</div>
          <div className="empty-p">Search for songs, artists, or albums to begin</div>
          <button onClick={() => onNavigate('search')} style={{
            marginTop: 20, padding: '10px 28px',
            background: 'var(--c-text)', color: 'var(--c-surface)',
            borderRadius: 999, fontWeight: 600, fontSize: 13,
          }}>Search for music</button>
        </div>
      )}

      {recent.length > 0 && (
        <div className="sec">
          <div className="sec-head"><h2 className="h2">Recently Played</h2></div>
          <div className="shelf">
            {recent.map(t => <MediaCard key={t.id} track={t} playing={state.currentTrack?.id === t.id} onPlay={onPlay} />)}
          </div>
        </div>
      )}

      {queued.length > 0 && (
        <div className="sec">
          <div className="sec-head">
            <h2 className="h2">Up Next</h2>
            {queued.length >= 6 && <button className="sec-more" onClick={() => onNavigate('queue')}>View all</button>}
          </div>
          <div className="shelf">
            {queued.map((qi: QueueItem, i: number) => <MediaCard key={`${qi.track.id}-${i}`} track={qi.track} playing={state.currentTrack?.id === qi.track.id} onPlay={onPlay} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function MediaCard({ track, playing, onPlay }: { track: Track; playing: boolean; onPlay: (t: Track) => void }) {
  return (
    <div className={`card ${playing ? 'playing' : ''}`} onClick={() => onPlay(track)}>
      <div className="card-art-wrap">
        <img src={thumb(track.id)} alt="" className="card-art" loading="lazy" />
        <div className="card-play"><Play size={18} fill="currentColor" /></div>
      </div>
      <div className="card-title">{track.title || 'Unknown'}</div>
      <div className="card-sub">{track.uploader || 'Unknown artist'}</div>
    </div>
  );
}
