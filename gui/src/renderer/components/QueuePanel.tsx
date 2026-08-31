import { useRef, useState } from 'react';
import { X, List, Mic2, GripVertical } from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';
import type { Track, QueueItem, LyricsLine } from '../../shared/types';
import { artworkFor, fmt } from '../lib/media';

type RightTab = 'queue' | 'lyrics';

interface QueuePanelProps {
  open: boolean;
  tab: RightTab;
  onTab: (tab: RightTab) => void;
  state: PlayerState;
  onClose: () => void;
  onPlayIndex: (index: number) => void;
  onClear: () => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onSavePlaylist: (name: string) => void;
  onPlayNext: (track: Track) => void;
}

function activeLyricIndex(lines: LyricsLine[], positionSec: number): number {
  const pos = positionSec * 1000;
  let current = -1;
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i]?.startMs;
    if (start === undefined) continue;
    if (start <= pos) current = i;
    else break;
  }
  return current;
}

export function QueuePanel({
  open, tab, onTab, state, onClose, onPlayIndex, onClear, onRemove, onMove, onSavePlaylist, onPlayNext,
}: QueuePanelProps) {
  const { currentTrack, queue, playing, lyrics, lyricsLoading, position } = state;
  const hasQueue = queue.length > 0;
  const [playlistName, setPlaylistName] = useState('');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const dragged = useRef(false);
  const lines = lyrics && currentTrack && lyrics.trackId === currentTrack.id ? lyrics.lines : [];
  const activeLine = activeLyricIndex(lines, position);

  return (
    <div
      className={`drawer queue-panel${open ? ' open' : ''}`}
      role="complementary"
      aria-label={tab === 'lyrics' ? 'Lyrics' : 'Queue'}
      aria-hidden={!open}
      {...(!open ? { inert: true } : {})}
    >
      <div className="queue-panel-inner">
      <div className="drawer-header">
        <div>
          <div className="chip-row wrap" role="tablist" aria-label="Queue and lyrics">
            <button role="tab" aria-selected={tab === 'queue'} className={`chip${tab === 'queue' ? ' selected' : ''}`} onClick={() => onTab('queue')}>Queue</button>
            <button role="tab" aria-selected={tab === 'lyrics'} className={`chip${tab === 'lyrics' ? ' selected' : ''}`} onClick={() => onTab('lyrics')}>Lyrics</button>
          </div>
          <div className="page-sub">
            {tab === 'lyrics'
              ? (currentTrack ? currentTrack.title : 'No track')
              : (hasQueue ? `${queue.length} up next · this session` : 'This session')}
          </div>
        </div>
        <button className="ghost-btn" onClick={onClose} aria-label="Close panel">
          <X size={16} />
        </button>
      </div>

      <div className="drawer-body">
        {tab === 'lyrics' ? (
          !currentTrack ? (
            <div className="empty-block">
              <Mic2 size={28} strokeWidth={1.2} />
              <p>Play a song to load lyrics.</p>
            </div>
          ) : lyricsLoading ? (
            <p className="muted">Looking up lyrics…</p>
          ) : lines.length === 0 ? (
            <div className="empty-block sm">
              <p>No lyrics for this track.</p>
            </div>
          ) : (
            <div className="lyrics-list" role="list" aria-label="Lyrics">
              {lines.map((line, i) => (
                <p
                  key={`${line.startMs ?? i}-${i}`}
                  role="listitem"
                  className={`lyrics-line${i === activeLine ? ' current' : ''}`}
                >
                  {line.text}
                </p>
              ))}
            </div>
          )
        ) : (
          <>
            {currentTrack && (
              <div className="queue-now">
                <span className="art-well">
                  <img src={artworkFor(currentTrack)} alt="" />
                </span>
                <div className="queue-now-info">
                  <div className="queue-now-label">Now playing</div>
                  <div className="truncate" title={currentTrack.title}>{currentTrack.title}</div>
                  <div className="muted truncate" title={currentTrack.uploader}>{currentTrack.uploader}</div>
                </div>
                <div className={`eq eq-sm${playing ? '' : ' is-idle'}`} aria-hidden="true">
                  <div className="eq-bar" />
                  <div className="eq-bar" />
                  <div className="eq-bar" />
                  <div className="eq-bar" />
                  <div className="eq-bar" />
                </div>
              </div>
            )}

            {hasQueue && (
              <div role="list" aria-label="Up next">
                <div className="section-kicker">Up next</div>
                {queue.map((qi: QueueItem, i: number) => {
                  const active = currentTrack?.id === qi.track.id;
                  return (
                    <div
                      key={`${qi.track.id}-${i}`}
                      className={`track-row${active ? ' active' : ''}${dragFrom === i ? ' dragging' : ''}`}
                      role="listitem"
                      draggable
                      onDragStart={() => { dragged.current = true; setDragFrom(i); }}
                      onDragOver={e => { e.preventDefault(); }}
                      onDrop={() => {
                        if (dragFrom !== null && dragFrom !== i) onMove(dragFrom, i);
                        setDragFrom(null);
                      }}
                      onDragEnd={() => setDragFrom(null)}
                      onClick={() => {
                        if (dragged.current) { dragged.current = false; return; }
                        onPlayIndex(i);
                      }}
                      tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && onPlayIndex(i)}
                    >
                      <span className="drag-handle" aria-hidden="true"><GripVertical size={12} /></span>
                      <span className="track-row-art">
                        <img src={artworkFor(qi.track)} alt="" />
                      </span>
                      <div className="track-row-info">
                        <div className="track-row-name truncate" title={qi.track.title}>{qi.track.title}</div>
                        <div className="track-row-artist truncate" title={`${qi.track.uploader || 'Unknown'} · ${qi.source}`}>
                          {qi.track.uploader || 'Unknown'} · {qi.source}
                        </div>
                      </div>
                      <div className="track-row-tail">
                        {qi.track.duration ? <span className="track-row-dur">{fmt(qi.track.duration)}</span> : null}
                        <button
                          className="ghost-btn sm row-action"
                          onClick={e => { e.stopPropagation(); onPlayNext(qi.track); }}
                          title="Play next"
                          aria-label={`Play ${qi.track.title} next`}
                        >
                          ↑
                        </button>
                        <button
                          className="ghost-btn sm row-action"
                          onClick={e => { e.stopPropagation(); onRemove(i); }}
                          title="Remove from queue"
                          aria-label={`Remove ${qi.track.title}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
                  The queue is this listening session. Save it as a playlist to keep it.
                </p>
                <button className="text-link" onClick={onClear} id="queue-clear-btn">Clear queue</button>
                <form
                  className="inline-form"
                  onSubmit={e => {
                    e.preventDefault();
                    const name = playlistName.trim();
                    if (!name) return;
                    onSavePlaylist(name);
                    setPlaylistName('');
                  }}
                >
                  <input
                    className="inline-input"
                    value={playlistName}
                    onChange={e => setPlaylistName(e.target.value)}
                    placeholder="Save as playlist"
                    aria-label="Playlist name"
                  />
                  <button className="text-link" type="submit" disabled={!playlistName.trim()}>Save</button>
                </form>
              </div>
            )}

            {!currentTrack && !hasQueue && (
              <div className="empty-block">
                <List size={28} strokeWidth={1.2} />
                <p>Queue is empty</p>
                <p className="muted">This session only. Playlists persist separately.</p>
              </div>
            )}
          </>
        )}
      </div>
      </div>
    </div>
  );
}
