import type { Track } from './types';
import { resolveCommand } from './platform';
import { getYtdlpPrivacyArgs } from './privacy';

export async function search(query: string, limit = 8): Promise<Track[]> {
  const text = await runYtdlp([
    `ytsearch${limit}:${query}`,
    '--dump-json',
    '--flat-playlist',
    '--quiet',
  ]);

  return parseTracks(text);
}

function parseTracks(text: string): Track[] {
  return text
    .split('\n')
    .filter(Boolean)
    .flatMap(line => {
      try {
        const d = JSON.parse(line);
        return [{
          id: d.id,
          title: d.title,
          url: `https://www.youtube.com/watch?v=${d.id}`,
          duration: d.duration,
          uploader: d.uploader || d.channel,
        }];
      } catch {
        return [];
      }
    });
}

export async function fetchMix(videoId: string, limit = 25): Promise<Track[]> {
  const url = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
  const text = await runYtdlp([
    url,
    '--dump-json',
    '--flat-playlist',
    '--quiet',
    '--playlist-end',
    String(limit),
  ]);

  return parseTracks(text);
}

async function runYtdlp(args: string[]): Promise<string> {
  const ytdlp = resolveCommand('yt-dlp') ?? 'yt-dlp';
  const proc = Bun.spawn([ytdlp, ...getYtdlpPrivacyArgs(), ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const [exitCode, output, errorOutput] = await Promise.all([proc.exited, stdout, stderr]);

  if (exitCode !== 0) {
    const detail = errorOutput.trim().slice(-4000);
    throw new Error(detail || `yt-dlp exited with code ${exitCode}.`);
  }

  return output;
}
