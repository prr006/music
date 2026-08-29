import { useState } from 'react';
import { Play, Trash2, ListMusic } from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';
import type { Track, QueueItem } from '../../shared/types';

interface B { removeFromQueue(i: number): void; clearQueue(): void; play(t: Track): void; }

function thumb(id: string) { return `https://img.youtube.com/vi/${id}/mqdefault.jpg`; }
function fmt(s?: number) { return s ? `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}` : ''; }

export function QueueView({ state, b }: { state: PlayerState; b: B }) {
  const [hov, setHov] = useState<number | null>(null);
  const { queue, currentTrack, loading } = state;

  return (
    <div style={{ animation: 'fadeIn 0.3s' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <h1 className="h1" style={{ margin: 0 }}>Queue</h1>
        {queue.length > 0 && <button className="ib" onClick={b.clearQueue} title="Clear queue" style={{ color: 'var(--c-accent)' }}><Trash2 size={16} /></button>}
      </div>

      {currentTrack && (
        <div style={{ marginBottom: 28 }}>
          <div className="q-label">Now Playing</div>
          <div className="row on" style={{ background: 'var(--c-accent-bg)' }}>
            <div className="row-n"><div className="eq"><span /><span /><span /></div></div>
            <div className="row-art"><img src={thumb(currentTrack.id)} alt="" /></div>
            <div className="row-info">
              <div className="row-name" style={{ color: 'var(--c-accent)' }}>{currentTrack.title || 'Unknown'}</div>
              <div className="row-artist">{loading ? 'Loading...' : (currentTrack.uploader || 'Unknown')}</div>
            </div>
          </div>
        </div>
      )}

      {queue.length > 0 && (
        <div>
          <div className="q-label">Next Up · {queue.length} track{queue.length !== 1 ? 's' : ''}</div>
          <div className="rows">
            {queue.map((qi: QueueItem, idx: number) => {
              const isCur = currentTrack?.id === qi.track.id;
              return (
                <div key={`${qi.track.id}-${idx}`} className={`row ${isCur ? 'on' : ''}`}
                  onMouseEnter={() => setHov(idx)} onMouseLeave={() => setHov(null)}>
                  <div className="row-n">{isCur ? <div className="eq"><span /><span /><span /></div> : <span>{idx + 1}</span>}</div>
                  <div className="row-art"><img src={thumb(qi.track.id)} alt="" loading="lazy" /></div>
                  <div className="row-info">
                    <div className="row-name">{qi.track.title || 'Unknown'}</div>
                    <div className="row-artist">{qi.track.uploader || 'Unknown'}{qi.track.duration ? ` · ${fmt(qi.track.duration)}` : ''}</div>
                  </div>
                  {hov === idx && (
                    <div className="row-acts" style={{ opacity: 1 }}>
                      <button className="ib ib-sm" onClick={e => { e.stopPropagation(); b.play(qi.track); }} title="Play"><Play size={14} fill="currentColor" /></button>
                      <button className="ib ib-sm" onClick={e => { e.stopPropagation(); b.removeFromQueue(idx); }} title="Remove" style={{ color: 'var(--c-accent)' }}><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {queue.length === 0 && (
        <div className="empty">
          <ListMusic className="empty-icon" size={48} strokeWidth={1.5} />
          <div className="empty-h">Queue is empty</div>
          <div className="empty-p">Add songs from search to build your queue</div>
        </div>
      )}
    </div>
  );
}
