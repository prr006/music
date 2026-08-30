import { describe, expect, test } from 'bun:test';
import { captionUrlFromDump, parseVtt } from '../src/melo/lyrics/parse-vtt';
import { YoutubeLyrics } from '../src/melo/lyrics/youtube-lyrics';

const VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
Hello there

00:00:04.500 --> 00:00:08.000
Second line
`;

describe('lyrics parsing', () => {
  test('parses vtt cues and timestamps', () => {
    const lines = parseVtt(VTT);
    expect(lines).toEqual([
      { text: 'Hello there', startMs: 1000 },
      { text: 'Second line', startMs: 4500 },
    ]);
  });

  test('picks english vtt caption url from dump', () => {
    expect(captionUrlFromDump({
      automatic_captions: {
        en: [{ ext: 'vtt', url: 'https://example.test/en.vtt' }],
      },
    })).toBe('https://example.test/en.vtt');
  });

  test('returns empty when dump has no captions', () => {
    expect(captionUrlFromDump({ title: 'Song' })).toBeNull();
  });

  test('malformed captions do not invent timestamps', () => {
    expect(parseVtt('not captions at all')).toEqual([]);
    expect(parseVtt('WEBVTT\n\njust text')).toEqual([]);
  });
});

describe('youtube lyrics provider', () => {
  test('does not throw when captions are missing', async () => {
    const lyrics = new YoutubeLyrics(async () => JSON.stringify({ id: 'abc' }), async () => '');
    const result = await lyrics.lyricsFor({
      id: 'abc',
      title: 'Song',
      url: 'https://www.youtube.com/watch?v=abc',
    });
    expect(result.lines).toEqual([]);
    expect(result.trackId).toBe('abc');
  });

  test('parses fetched captions', async () => {
    const lyrics = new YoutubeLyrics(
      async () => JSON.stringify({ subtitles: { en: [{ ext: 'vtt', url: 'https://example.test/x.vtt' }] } }),
      async () => VTT,
    );
    const result = await lyrics.lyricsFor({
      id: 'xyz',
      title: 'Song',
      url: 'https://www.youtube.com/watch?v=xyz',
    });
    expect(result.lines[0]?.text).toBe('Hello there');
  });
});
