import { getYtdlpPrivacyArgs } from '../../privacy';
import { logError } from '../log';
import { requireRuntimeBinary } from '../runtime/binaries';

export class YtdlpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YtdlpError';
  }
}

export async function runYtdlp(args: string[]): Promise<string> {
  const ytdlp = requireRuntimeBinary('yt-dlp');
  const proc = Bun.spawn([ytdlp, ...getYtdlpPrivacyArgs(), ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, output, errorOutput] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    const detail = errorOutput.trim().slice(-4000);
    logError('youtube', `yt-dlp failed (${exitCode}): ${detail.slice(0, 240)}`);
    throw new YtdlpError(detail || `yt-dlp exited with code ${exitCode}.`);
  }

  return output;
}
