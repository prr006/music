import { useState, useCallback, useRef } from 'react';
import { Search, Play, ListPlus, SkipForward } from 'lucide-react';
import type { Track } from '../../shared/types';

interface Props {
  results: Track[]; searching: boolean;
  onSearch: (q: string) => void; onPlay: (t: Track) => void;
  onAddToQueue: (t: Track) => void; onPlayNext: (t: Track) => void;
  currentTrack: Track | null; loadingTrack: Track | null;
}

function thumb(id: string) { return `https://img.youtube.com/vi/${id}/mqdefault.jpg`; }
function fmt(s?: number) { return s ? `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}` : ''; }

export function SearchView({ results, searching, onSearch, onPlay, onAddToQueue, onPlayNext, currentTrack, loadingTrack }: Props) {
  const [q, setQ] = useState('');
  const [hov, setHov] = useState<number | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const go = useCallback((e: React.FormEvent) => { e.preventDefault(); if (q.trim()) onSearch(q); }, [q, onSearch]);

  return (
    <div style={{ animation: 'fadeIn 0.3s' }}>
      <h1 className="h1">Search</h1>
      <p className="sub" style={{ marginBottom: 20 }}>Discover music from YouTube Music</p>

      <form onSubmit={go} className="search-wrap">
        <Search className="search-pos" size={16} />
        <input ref={ref} type="text" value={q} onChange={e => setQ(e.target.value)}
          placeholder="What do you want to listen to?" className="search-in" autoFocus />
      </form>

      {searching && (
        <div className="rows">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skel-row">
              <div className="skel" style={{ width: 24, height: 12 }} />
              <div className="skel" style={{ width: 40, height: 40, borderRadius: 4 }} />
              <div style={{ flex: 1 }}>
                <div className="skel" style={{ width: '55%', height: 12, marginBottom: 6 }} />
                <div className="skel" style={{ width: '35%', height: 10 }} />
              </div>
              <div className="skel" style={{ width: 32, height: 12 }} />
            </div>
          ))}
        </div>
      )}

      {!searching && results.length === 0 && (
        <div className="empty"><Search className="empty-icon" size={40} strokeWidth={1.5} /><div className="empty-h">Search for something to listen to</div></div>
      )}

      {!searching && results.length > 0 && (
        <div>
          <div className="result-count">{results.length} result{results.length !== 1 ? 's' : ''}</div>
          <div className="rows">
            {results.map((t, i) => {
              const isOn = currentTrack?.id === t.id && !loadingTrack;
              const isLoading = loadingTrack?.id === t.id;
              return (
                <div key={t.id} className={`row ${isOn ? 'on' : ''}`}
                  onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
                  onDoubleClick={() => onPlay(t)}>
                  <div className="row-n">
                    {isOn ? <div className="eq"><span /><span /><span /></div>
                    : isLoading ? <div className="spin spin-s" />
                    : <span>{i + 1}</span>}
                  </div>
                  <div className="row-art">
                    <img src={thumb(t.id)} alt="" loading="lazy" />
                    {(hov === i || isLoading) && (
                      <div className="row-art-hover" onClick={() => onPlay(t)}>
                        {isLoading ? <div className="spin spin-s" style={{ borderColor: 'rgba(255,255,255,0.2)', borderTopColor: '#fff' }} />
                        : <Play size={14} fill="#fff" color="#fff" />}
                      </div>
                    )}
                  </div>
                  <div className="row-info">
                    <div className="row-name">{t.title || 'Unknown'}</div>
                    <div className="row-artist">{t.uploader || 'Unknown artist'}</div>
                  </div>
                  {hov !== i && t.duration && <div className="row-dur">{fmt(t.duration)}</div>}
                  <div className="row-acts" style={hov === i ? { opacity: 1 } : undefined}>
                    <button className="ib ib-sm" onClick={e => { e.stopPropagation(); onPlayNext(t); }} title="Play next"><SkipForward size={14} /></button>
                    <button className="ib ib-sm" onClick={e => { e.stopPropagation(); onAddToQueue(t); }} title="Add to queue"><ListPlus size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
