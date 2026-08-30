export interface LyricsLine {
  text: string;
  startMs?: number;
}

function parseTimestamp(raw: string): number | undefined {
  const match = raw.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!match) return undefined;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4]!.padEnd(3, '0');
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number(fraction);
}

function cleanCue(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse WebVTT or simple SRT into display lines. Timestamps are kept for later sync. */
export function parseVtt(input: string): LyricsLine[] {
  const lines: LyricsLine[] = [];
  const blocks = input.replace(/^\uFEFF/, '').split(/\r?\n\r?\n/);
  const seen = new Set<string>();

  for (const block of blocks) {
    const rows = block.split(/\r?\n/).filter(row => row.trim() && row.trim() !== 'WEBVTT' && !row.startsWith('NOTE') && !row.startsWith('Kind:') && !row.startsWith('Language:'));
    if (rows.length === 0) continue;
    const timeRow = rows.find(row => row.includes('-->'));
    if (!timeRow) continue;
    const startRaw = timeRow.split('-->')[0] ?? '';
    const startMs = parseTimestamp(startRaw);
    const text = cleanCue(rows.filter(row => row !== timeRow && !/^\d+$/.test(row.trim())).join(' '));
    if (!text) continue;
    const key = `${startMs ?? ''}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(startMs === undefined ? { text } : { text, startMs });
  }
  return lines;
}

export function captionUrlFromDump(dump: unknown): string | null {
  if (!dump || typeof dump !== 'object') return null;
  const record = dump as Record<string, unknown>;
  const buckets = [record.subtitles, record.automatic_captions];
  const langs = ['en', 'en-US', 'en-GB', 'en-orig'];
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== 'object') continue;
    const map = bucket as Record<string, unknown>;
    for (const lang of langs) {
      const entries = map[lang];
      if (!Array.isArray(entries)) continue;
      const vtt = entries.find((item: unknown) => {
        if (!item || typeof item !== 'object') return false;
        const ext = String((item as { ext?: string }).ext ?? '');
        return ext === 'vtt' || ext === 'srv3' || ext === 'srt';
      }) as { url?: string } | undefined;
      if (vtt?.url) return vtt.url;
      const first = entries[0] as { url?: string } | undefined;
      if (first?.url) return first.url;
    }
    for (const value of Object.values(map)) {
      if (!Array.isArray(value) || value.length === 0) continue;
      const first = value[0] as { url?: string } | undefined;
      if (first?.url) return first.url;
    }
  }
  return null;
}
