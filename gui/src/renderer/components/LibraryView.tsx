import { useMemo, useState } from 'react';
import { Heart, Plus, Trash2 } from 'lucide-react';
import type { PlayerState } from '../hooks/useBackend';
import type { Track, Playlist } from '../../shared/types';
import { artworkFor, fmt } from '../lib/media';
import { groupByAlbum, groupByArtist } from '../lib/search-groups';

type LibraryTab = 'songs' | 'albums' | 'artists' | 'playlists' | 'downloads';

interface LibraryViewProps {
  state: PlayerState;
  onPlay: (t: Track) => void;
  onToggleFavorite: (t?: Track) => void;
  onOpenSearch: () => void;
  onCreatePlaylist: (name: string) => void;
  onDeletePlaylist: (id: string) => void;
  onRenamePlaylist: (id: string, name: string) => void;
  onPlayPlaylist: (id: string, index?: number) => void;
  onRemoveFromPlaylist: (id: string, index: number) => void;
  onReorderPlaylist: (id: string, from: number, to: number) => void;
  onAddToQueue: (t: Track) => void;
  onPlayNext: (t: Track) => void;
  onClearHistory: () => void;
}

function uniqueTracks(lists: Track[][]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const list of lists) {
    for (const t of list) {
      if (!t?.id || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

function TrackRows({
  tracks, currentId, favIds, onPlay, onToggleFavorite, onAddToQueue, onPlayNext,
}: {
  tracks: Track[];
  currentId?: string;
  favIds: Set<string>;
  onPlay: (t: Track) => void;
  onToggleFavorite: (t?: Track) => void;
  onAddToQueue: (t: Track) => void;
  onPlayNext: (t: Track) => void;
}) {
  return (
    <div className="track-list" role="list">
      {tracks.map(track => {
        const isFav = favIds.has(track.id);
        return (
          <div
            key={track.id}
            className={`track-row${currentId === track.id ? ' active' : ''}`}
            role="listitem"
            onClick={() => onPlay(track)}
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onPlay(track)}
          >
            <span className="track-row-art"><img src={artworkFor(track)} alt="" /></span>
            <div className="track-row-info">
              <div className="track-row-name truncate" title={track.title}>{track.title}</div>
              <div className="track-row-artist truncate">{track.uploader || 'Unknown'}</div>
            </div>
            <div className="track-row-tail">
              {track.duration ? <span className="track-row-dur">{fmt(track.duration)}</span> : null}
              <button className={`ghost-btn sm row-action${isFav ? ' fav' : ''}`} onClick={e => { e.stopPropagation(); onToggleFavorite(track); }} aria-label={isFav ? 'Unfavorite' : 'Favorite'}>
                <Heart size={12} fill={isFav ? 'currentColor' : 'none'} />
              </button>
              <button className="ghost-btn sm row-action" onClick={e => { e.stopPropagation(); onPlayNext(track); }} aria-label="Play next">↑</button>
              <button className="ghost-btn sm row-action" onClick={e => { e.stopPropagation(); onAddToQueue(track); }} aria-label="Add to queue">+</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function LibraryView({
  state, onPlay, onToggleFavorite, onOpenSearch,
  onCreatePlaylist, onDeletePlaylist, onRenamePlaylist, onPlayPlaylist,
  onRemoveFromPlaylist, onReorderPlaylist, onAddToQueue, onPlayNext, onClearHistory,
}: LibraryViewProps) {
  const { history, favorites, currentTrack, queue, playlists, downloads } = state;
  const [tab, setTab] = useState<LibraryTab>('songs');
  const [openPlaylist, setOpenPlaylist] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [rename, setRename] = useState('');
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const songs = useMemo(
    () => uniqueTracks([
      currentTrack ? [currentTrack] : [],
      favorites,
      history,
      downloads,
      queue.map(q => q.track),
    ]),
    [currentTrack, favorites, history, downloads, queue],
  );
  const albums = useMemo(() => groupByAlbum(songs), [songs]);
  const artists = useMemo(() => groupByArtist(songs), [songs]);
  const favIds = useMemo(() => new Set(favorites.map(f => f.id)), [favorites]);
  const selected: Playlist | undefined = playlists.find(p => p.id === openPlaylist);

  return (
    <div className="library-page" role="main" aria-label="Library">
      <header className="library-head">
        <h1 className="page-title">Library</h1>
        <p className="page-sub">Songs you have played, saved, or downloaded.</p>
      </header>

      <div className="chip-row" role="tablist" aria-label="Library sections">
        {([
          ['songs', 'Songs'],
          ['albums', 'Albums'],
          ['artists', 'Artists'],
          ['playlists', 'Playlists'],
          ['downloads', 'Downloads'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`chip${tab === id ? ' selected' : ''}`}
            onClick={() => { setTab(id); setOpenPlaylist(null); }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'songs' && (
        songs.length === 0 ? (
          <div className="empty-block">
            <p>Your library is empty.</p>
            <button className="text-link" onClick={onOpenSearch}>Search for music</button>
          </div>
        ) : (
          <>
            <div className="section-kicker">Songs</div>
            {history.length > 0 && (
              <>
                <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
                  Previous uses recently played. Clearing this list also clears Previous.
                </p>
                <button className="text-link" onClick={onClearHistory}>Clear recently played</button>
              </>
            )}
            <TrackRows tracks={songs} currentId={currentTrack?.id} favIds={favIds} onPlay={onPlay} onToggleFavorite={onToggleFavorite} onAddToQueue={onAddToQueue} onPlayNext={onPlayNext} />
          </>
        )
      )}

      {tab === 'albums' && (
        albums.length === 0 ? (
          <div className="empty-block"><p>No album names in your library yet.</p></div>
        ) : (
          <div className="album-grid" role="list">
            {albums.map(group => (
              <article key={group.name} className="album-card" role="listitem">
                <button className="album-cover" onClick={() => onPlay(group.tracks[0]!)} aria-label={`Play ${group.name}`}>
                  <img src={artworkFor(group.tracks[0]!)} alt="" />
                </button>
                <div className="album-meta">
                  <div className="album-title truncate">{group.name}</div>
                  <div className="album-artist truncate">{group.tracks.length} track{group.tracks.length === 1 ? '' : 's'}</div>
                </div>
              </article>
            ))}
          </div>
        )
      )}

      {tab === 'artists' && (
        artists.length === 0 ? (
          <div className="empty-block"><p>No artists yet.</p></div>
        ) : (
          <div className="album-grid" role="list">
            {artists.map(group => (
              <article key={group.name} className="album-card" role="listitem">
                <button className="album-cover" onClick={() => onPlay(group.tracks[0]!)} aria-label={`Play ${group.name}`}>
                  <img src={artworkFor(group.tracks[0]!)} alt="" />
                </button>
                <div className="album-meta">
                  <div className="album-title truncate">{group.name}</div>
                  <div className="album-artist truncate">{group.tracks.length} track{group.tracks.length === 1 ? '' : 's'}</div>
                </div>
              </article>
            ))}
          </div>
        )
      )}

      {tab === 'downloads' && (
        downloads.length === 0 ? (
          <div className="empty-block"><p>No downloads yet.</p></div>
        ) : (
          <TrackRows tracks={downloads} currentId={currentTrack?.id} favIds={favIds} onPlay={onPlay} onToggleFavorite={onToggleFavorite} onAddToQueue={onAddToQueue} onPlayNext={onPlayNext} />
        )
      )}

      {tab === 'playlists' && !selected && (
        <>
          <form
            className="inline-form"
            onSubmit={e => {
              e.preventDefault();
              if (!newName.trim()) return;
              onCreatePlaylist(newName.trim());
              setNewName('');
            }}
          >
            <input className="inline-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="New playlist" aria-label="New playlist name" />
            <button className="ghost-btn sm" type="submit" aria-label="Create playlist"><Plus size={14} /></button>
          </form>
          {playlists.length === 0 ? (
            <div className="empty-block"><p>No playlists yet.</p></div>
          ) : (
            <div className="track-list" role="list">
              {playlists.map(pl => (
                <div key={pl.id} className="track-row" role="listitem" onClick={() => { setOpenPlaylist(pl.id); setRename(pl.name); }}>
                  <div className="track-row-info">
                    <div className="track-row-name truncate">{pl.name}</div>
                    <div className="track-row-artist">{pl.tracks.length} track{pl.tracks.length === 1 ? '' : 's'}</div>
                  </div>
                  <div className="track-row-tail">
                    <button className="ghost-btn sm row-action" onClick={e => { e.stopPropagation(); onPlayPlaylist(pl.id, 0); }} aria-label={`Play ${pl.name}`}>Play</button>
                    <button className="ghost-btn sm row-action" onClick={e => { e.stopPropagation(); onDeletePlaylist(pl.id); }} aria-label={`Delete ${pl.name}`}><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'playlists' && selected && (
        <>
          <button className="text-link" onClick={() => setOpenPlaylist(null)}>Back to playlists</button>
          <form
            className="inline-form"
            onSubmit={e => {
              e.preventDefault();
              if (rename.trim() && rename.trim() !== selected.name) onRenamePlaylist(selected.id, rename.trim());
            }}
          >
            <input className="inline-input" value={rename} onChange={e => setRename(e.target.value)} aria-label="Rename playlist" />
            <button className="text-link" type="submit">Rename</button>
            <button className="text-link" type="button" onClick={() => onPlayPlaylist(selected.id, 0)}>Play</button>
          </form>
          {selected.tracks.length === 0 ? (
            <div className="empty-block"><p>This playlist is empty.</p></div>
          ) : (
            <div className="track-list" role="list">
              {selected.tracks.map((track, i) => (
                <div
                  key={`${track.id}-${i}`}
                  className="track-row"
                  role="listitem"
                  draggable
                  onDragStart={() => setDragFrom(i)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => {
                    if (dragFrom !== null && dragFrom !== i) onReorderPlaylist(selected.id, dragFrom, i);
                    setDragFrom(null);
                  }}
                  onClick={() => onPlayPlaylist(selected.id, i)}
                >
                  <span className="track-row-art"><img src={artworkFor(track)} alt="" /></span>
                  <div className="track-row-info">
                    <div className="track-row-name truncate">{track.title}</div>
                    <div className="track-row-artist truncate">{track.uploader || 'Unknown'}</div>
                  </div>
                  <button className="ghost-btn sm row-action" onClick={e => { e.stopPropagation(); onRemoveFromPlaylist(selected.id, i); }} aria-label="Remove"><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
