import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(ROOT, 'runtime-manifest.json');
const OUT_DIR = join(ROOT, 'gui', 'resources', 'runtime');

export function sha256Buffer(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function assertSha256(data: Uint8Array, expected: string, label: string) {
  const actual = sha256Buffer(data);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label} sha256 mismatch: expected ${expected}, got ${actual}`);
  }
}

interface YtdlpAsset {
  version: string;
  url: string;
  sha256: string;
  fileName: string;
}

interface MpvAsset {
  version: string;
  url: string;
  sha256: string;
  archive: string;
  executable: string;
  outputDir: string;
}

interface PlatformManifest {
  'yt-dlp': YtdlpAsset;
  mpv: MpvAsset;
}

async function main() {
  const target = process.argv[2] || 'win32-x64';
  const manifest = JSON.parse(await Bun.file(MANIFEST_PATH).text()) as Record<string, PlatformManifest>;
  const platform = manifest[target];
  if (!platform) throw new Error(`No runtime manifest for ${target}`);

  mkdirSync(OUT_DIR, { recursive: true });
  const tmp = join(OUT_DIR, '.tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  const ytdlpPath = join(OUT_DIR, platform['yt-dlp'].fileName);
  console.log(`Fetching yt-dlp ${platform['yt-dlp'].version}`);
  const ytdlpBytes = await download(platform['yt-dlp'].url);
  assertSha256(ytdlpBytes, platform['yt-dlp'].sha256, 'yt-dlp.exe');
  writeFileSync(ytdlpPath, ytdlpBytes);
  console.log(`Wrote ${ytdlpPath}`);

  console.log(`Fetching mpv ${platform.mpv.version}`);
  const archiveBytes = await download(platform.mpv.url);
  assertSha256(archiveBytes, platform.mpv.sha256, platform.mpv.url.split('/').pop() || 'mpv archive');
  const archivePath = join(tmp, platform.mpv.url.split('/').pop() || 'mpv.7z');
  writeFileSync(archivePath, archiveBytes);
  const extracted = join(tmp, 'mpv-extract');
  mkdirSync(extracted, { recursive: true });
  await extractArchive(archivePath, extracted);

  const exe = findFile(extracted, platform.mpv.executable, 6);
  if (!exe) throw new Error(`Extracted mpv archive did not contain ${platform.mpv.executable}`);
  const mpvOut = join(OUT_DIR, platform.mpv.outputDir);
  rmSync(mpvOut, { recursive: true, force: true });
  mkdirSync(mpvOut, { recursive: true });
  copyTree(dirname(exe), mpvOut);
  if (!existsSync(join(mpvOut, platform.mpv.executable))) {
    throw new Error(`mpv output is missing ${platform.mpv.executable}`);
  }
  console.log(`Wrote ${join(mpvOut, platform.mpv.executable)}`);

  rmSync(tmp, { recursive: true, force: true });
  console.log(`Desktop runtime ready in ${OUT_DIR}`);
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Download failed ${response.status} ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function extractArchive(archivePath: string, dest: string) {
  const seven = resolveSevenZip();
  if (!seven) {
    throw new Error('7z is required to extract the Windows mpv archive. Install p7zip-full (Linux) or 7-Zip (Windows).');
  }
  const proc = Bun.spawn([seven, 'x', `-o${dest}`, '-y', archivePath], { stdout: 'inherit', stderr: 'inherit' });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`7z exited with code ${code}`);
}

function resolveSevenZip(): string | null {
  for (const name of ['7z', '7za', '7zr']) {
    const proc = Bun.spawnSync(['sh', '-c', `command -v ${name}`], { stdout: 'pipe' });
    const path = proc.stdout.toString().trim();
    if (proc.exitCode === 0 && path) return path;
  }
  return null;
}

function findFile(dir: string, fileName: string, depth: number): string | null {
  if (depth < 0 || !existsSync(dir)) return null;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    if (entry.toLowerCase() === fileName.toLowerCase() && statSync(full).isFile()) return full;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      if (statSync(full).isDirectory()) {
        const found = findFile(full, fileName, depth - 1);
        if (found) return found;
      }
    } catch {}
  }
  return null;
}

function copyTree(from: string, to: string) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const src = join(from, entry);
    const dest = join(to, entry);
    const stat = statSync(src);
    if (stat.isDirectory()) copyTree(src, dest);
    else copyFileSync(src, dest);
  }
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
