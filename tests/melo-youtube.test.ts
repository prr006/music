import { describe, expect, test, mock } from 'bun:test';
import { parseDumpLines, trackFromDump, thumbnailFor } from '../src/melo/youtube/parse';
import { QueueService } from '../src/melo/queue/queue-service';
import type { Track } from '../src/melo/types';

function track(id: string): Track {
  return { id, title: id, url: `https://www.youtube.com/watch?v=${id}` };
}

describe('YouTube dump parsing', () => {
  test('parses NDJSON dumps into tracks with artwork', () => {
    const text = [
      JSON.stringify({
        id: 'abc',
        title: 'Song',
        uploader: 'Artist',
        duration: 120,
        thumbnail: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
      }),
      'not json',
      JSON.stringify({ id: 'abc', title: 'dup' }),
      JSON.stringify({ id: 'def', title: 'Other', channel: 'Chan' }),
    ].join('\n');

    const tracks = parseDumpLines(text);
    expect(tracks.map(t => t.id)).toEqual(['abc', 'def']);
    expect(tracks[0]!.artwork).toBe('https://i.ytimg.com/vi/abc/hqdefault.jpg');
    expect(tracks[0]!.uploader).toBe('Artist');
    expect(tracks[1]!.uploader).toBe('Chan');
    expect(tracks[1]!.url).toBe('https://www.youtube.com/watch?v=def');
  });

  test('skips dumps without id or title', () => {
    expect(trackFromDump({ id: '', title: 'x' })).toBeNull();
    expect(trackFromDump({ id: 'x', title: '' })).toBeNull();
  });

  test('falls back to standard YouTube thumbnail', () => {
    expect(thumbnailFor('xyz')).toBe('https://i.ytimg.com/vi/xyz/mqdefault.jpg');
  });
});

describe('QueueService', () => {
  test('keeps manual tracks ahead of radio when shuffling', () => {
    const queue = new QueueService();
    queue.add(track('m1'), 'manual');
    queue.setRadio([track('r1'), track('r2'), track('r3')], true);
    const snapshot = queue.snapshot();
    expect(snapshot[0]!.source).toBe('manual');
    expect(snapshot[0]!.track.id).toBe('m1');
    expect(snapshot.slice(1).every(item => item.source === 'radio')).toBe(true);
  });

  test('appendRadio skips duplicates', () => {
    const queue = new QueueService();
    queue.setRadio([track('a'), track('b')]);
    queue.appendRadio([track('b'), track('c')]);
    expect(queue.snapshot().map(item => item.track.id)).toEqual(['a', 'b', 'c']);
  });
});

const ytdlpMock = mock(async (args: string[]) => {
  if (args[0]?.startsWith('ytsearch')) {
    return JSON.stringify({
      id: 'vid1',
      title: 'Hello',
      uploader: 'Someone',
      duration: 90,
      thumbnail: 'https://i.ytimg.com/vi/vid1/mqdefault.jpg',
    }) + '\n';
  }
  throw new Error('boom');
});

mock.module('../src/melo/youtube/ytdlp', () => ({
  YtdlpError: class YtdlpError extends Error {},
  runYtdlp: ytdlpMock,
}));

describe('YoutubeSearch / YoutubeRadio (mocked yt-dlp)', () => {
  test('search returns parsed tracks', async () => {
    const { YoutubeSearch } = await import('../src/melo/search/youtube-search');
    const search = new YoutubeSearch();
    const tracks = await search.search('hello', 3);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.id).toBe('vid1');
    expect(tracks[0]!.title).toBe('Hello');
    expect(tracks[0]!.artwork).toContain('ytimg');
  });

  test('empty query returns []', async () => {
    const { YoutubeSearch } = await import('../src/melo/search/youtube-search');
    const search = new YoutubeSearch();
    expect(await search.search('  ')).toEqual([]);
  });

  test('radio failure returns empty related list', async () => {
    const { YoutubeRadio } = await import('../src/melo/radio/youtube-radio');
    const radio = new YoutubeRadio();
    expect(await radio.related('abc')).toEqual([]);
  });
});
