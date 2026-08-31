#!/usr/bin/env node
/**
 * Prepare the self-contained MELO runtime for the Tauri/WebView2 bundle.
 *
 * The source is the already-verified Electron runtime (default
 * `gui/resources/runtime`). This script never modifies that source tree. It
 * copies only the files MELO uses into `lightweight/resources/bin`:
 *
 *   - yt-dlp.exe
 *   - mpv/mpv.exe
 *   - mpv/mpv.com (kept as a conservative fallback)
 *   - every DLL next to mpv.exe / mpv.com (never dropped)
 *
 * It drops documentation, installer/updater scripts, registration helpers and
 * non-mpv executables that MELO demonstrably does not use.
 *
 * Usage:
 *   node scripts/prepare-lightweight-runtime.js
 *   node scripts/prepare-lightweight-runtime.js --from <dir>
 *   node scripts/prepare-lightweight-runtime.js --allow-unpinned
 *
 * Flags:
 *   --from <dir>           source runtime directory (default gui/resources/runtime)
 *   --allow-unpinned       development mode: allows missing source/staging and skips
 *                          mandatory checks. Never use this for a release package.
 *   --require-hash         fail if yt-dlp.sha256 is not recorded in runtime.lock.json
 *   --allow-no-dll         allow mpv to have zero DLLs in the staged runtime
 */

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const flags = new Set();
const positional = [];
for (let i = 2; i < process.argv.length; i += 1) {
  const value = process.argv[i];
  if (value === '--from') {
    flags.add('--from');
    positional.push(process.argv[i + 1]);
    i += 1;
  } else {
    flags.add(value);
  }
}

const allowUnpinned = flags.has('--allow-unpinned');
const requireHash = flags.has('--require-hash');
const allowNoDll = flags.has('--allow-no-dll');
const fromFromArg = positional.find(() => true);

const defaultSource = join(root, 'gui', 'resources', 'runtime');
const requestedSource = process.env.MELO_RUNTIME_SRC || fromFromArg;
const sourceRoot = resolve(requestedSource || defaultSource);
const stageRoot = join(root, 'lightweight', 'resources', 'bin');
const stageMpvDir = join(stageRoot, 'mpv');
const stageMpvExe = join(stageMpvDir, 'mpv.exe');
const stageYtDlpExe = join(stageRoot, 'yt-dlp.exe');
const lockPath = join(root, 'lightweight', 'runtime.lock.json');

function eprintln(msg = '') {
  console.error(msg);
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else out.push({ path: full, size: stat.size });
  }
  return out;
}

function dirSize(dir) {
  const files = walk(dir);
  return {
    bytes: files.reduce((a, b) => a + b.size, 0),
    files: files.length,
  };
}

function existsSync(path) {
  try {
    return statSync(path).isFile() || statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function isRequiredMpvFile(relPath) {
  const name = basename(relPath).toLowerCase();
  const ext = extname(name).toLowerCase();
  const path = relPath.replace(/\\/g, '/').toLowerCase();

  if (ext === '.dll') return true;
  if (name === 'mpv.exe' || name === 'mpv.com' || name === 'mpv') return true;
  if (/(^|\/)(doc|docs|installer|installers|updater|updaters|examples|man|share\/doc)(\/|$)/.test(path)) return false;
  if (/^(license|copying|readme)([._-]|$)/.test(name)) return true;
  if (/installer|uninstall|updater|registry|register|update/.test(path)) return false;
  if (/\.(md|txt|rst|html?|changelog|reg|bat|cmd|ps1|sh|json|conf|ini)$/i.test(name)) return false;
  if (ext === '.exe' && name !== 'mpv.exe' && name !== 'mpv.com') return false;
  // Everything else is kept conservatively. Unknown files may be needed by the
  // mpv build; they are never dropped unless one of the rules above matches.
  return true;
}

function copyMinimalMpv(sourceMpvDir) {
  rmSync(stageMpvDir, { recursive: true, force: true });
  mkdirSync(stageMpvDir, { recursive: true });
  let copied = 0;
  let dropped = 0;
  for (const file of walk(sourceMpvDir)) {
    const rel = relative(sourceMpvDir, file.path);
    const keep = isRequiredMpvFile(rel);
    if (!keep) {
      dropped += 1;
      continue;
    }
    const dest = join(stageMpvDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file.path, dest);
    copied += 1;
  }
  return { copied, dropped };
}

function readLock() {
  if (!existsSync(lockPath)) {
    return {};
  }
  return JSON.parse(readFileSync(lockPath, 'utf8'));
}

async function main() {
  console.log('── MELO lightweight runtime prepare ─────────────────────');

  // Source discovery. When using the default runtime location, also accept the
  // older Electron layout where the runtime sits directly under gui/resources.
  const sourceRoots = requestedSource ? [sourceRoot] : [sourceRoot, join(root, 'gui', 'resources')];
  let sourceMpvDir = null;
  let sourceYtDlp = null;
  let resolvedSourceRoot = sourceRoot;
  for (const candidateRoot of sourceRoots) {
    const mpvCandidates = [
      join(candidateRoot, 'mpv'),
      join(candidateRoot, 'bin', 'mpv'),
    ];
    const ytCandidates = [
      join(candidateRoot, 'yt-dlp.exe'),
      join(candidateRoot, 'bin', 'yt-dlp.exe'),
    ];
    const foundMpv = mpvCandidates.find((p) => existsSync(join(p, 'mpv.exe'))) ?? null;
    const foundYt = ytCandidates.find((p) => existsSync(p)) ?? null;
    if (foundMpv || foundYt) {
      sourceMpvDir = foundMpv;
      sourceYtDlp = foundYt;
      resolvedSourceRoot = candidateRoot;
      break;
    }
  }

  const srcMpvOk = !!sourceMpvDir;
  const srcYtOk = !!sourceYtDlp;

  if (!srcMpvOk || !srcYtOk) {
    if (allowUnpinned) {
      console.warn(`WARNING: using --allow-unpinned. Source runtime missing: mpv=${srcMpvOk} yt-dlp=${srcYtOk}`);
      console.warn(`  checked ${sourceRoots.join(' and ')}`);
    } else {
      eprintln(`Runtime source not found. Checked:`);
      for (const candidate of sourceRoots) eprintln(`  ${candidate}`);
      if (!srcMpvOk) eprintln('  missing mpv/mpv.exe or bin/mpv/mpv.exe');
      if (!srcYtOk) eprintln('  missing yt-dlp.exe or bin/yt-dlp.exe');
      eprintln();
      eprintln('Place the verified Electron runtime there, or pass --from <dir> / --allow-unpinned.');
      process.exit(1);
    }
  }

  const beforeSource = dirSize(sourceMpvDir || join(resolvedSourceRoot, 'mpv'));

  if (!sourceMpvDir && !sourceYtDlp && allowUnpinned) {
    console.log('No runtime source found -- left existing staged runtime untouched.');
    console.log('runtime ready.');
    return;
  }

  rmSync(stageRoot, { recursive: true, force: true });
  mkdirSync(stageRoot, { recursive: true });

  // yt-dlp.exe
  if (sourceYtDlp) {
    copyFileSync(sourceYtDlp, stageYtDlpExe);
  }

  // mpv minimal copy
  let mpvCounts = { copied: 0, dropped: 0 };
  if (sourceMpvDir) {
    mpvCounts = copyMinimalMpv(sourceMpvDir);
  }

  const stageYtExists = existsSync(stageYtDlpExe);
  const stageMpvExists = existsSync(stageMpvExe);

  if ((!stageYtExists || !stageMpvExists) && !allowUnpinned) {
    eprintln('Staged runtime is incomplete:');
    if (!stageYtExists) eprintln('  missing yt-dlp.exe');
    if (!stageMpvExists) eprintln('  missing mpv/mpv.exe');
    process.exit(1);
  }

  const dllCount = existsSync(stageMpvDir)
    ? walk(stageMpvDir).filter((f) => f.path.toLowerCase().endsWith('.dll')).length
    : 0;
  if (stageMpvExists && dllCount === 0 && !allowNoDll) {
    eprintln('Staged mpv directory contains no DLLs. MELO’s bundled mpv distribution');
    eprintln('is expected to ship its runtime DLLs. If this build is genuinely static,');
    eprintln('re-run with --allow-no-dll after verifying mpv --version works.');
    process.exit(1);
  }

  const lock = readLock();
  const ytLock = lock?.['yt-dlp'] ?? {};
  const mpvLock = lock?.['mpv'] ?? {};
  const expectedSha = String(ytLock.sha256 || '').trim().toLowerCase();

  const fingerprint = {
    generatedAt: new Date().toISOString(),
    source: resolvedSourceRoot,
    versions: {
      'yt-dlp': ytLock.version || '(unknown)',
      mpv: mpvLock.version || '(unknown)',
    },
    files: {
      'yt-dlp.exe': stageYtExists ? sha256(stageYtDlpExe) : '',
      mpv: {
        files: existsSync(stageMpvDir) ? walk(stageMpvDir).length : 0,
        dllCount,
      },
    },
  };

    if (stageYtExists) {
      const actual = sha256(stageYtDlpExe);
      fingerprint.files['yt-dlp.exe'] = actual;
      if (expectedSha) {
        if (actual !== expectedSha) {
          eprintln(`yt-dlp.exe SHA-256 mismatch:`);
          eprintln(`  expected ${expectedSha}`);
          eprintln(`  actual   ${actual}`);
          rmSync(stageRoot, { recursive: true, force: true });
          try { rmSync(join(root, 'lightweight', 'resources', '.melo-runtime-fingerprint.json'), { force: true }); } catch {}
          process.exit(1);
        }
        console.log('yt-dlp.exe SHA-256 verified against runtime.lock.json');
      } else if (!allowUnpinned || requireHash) {
        eprintln('runtime.lock.json yt-dlp.sha256 is empty; refusing to ship an unpinned yt-dlp.exe.');
        eprintln('Run with --allow-unpinned for a local/dev staging run, or fill the lock file.');
        process.exit(1);
      } else {
        console.log(`yt-dlp.exe SHA-256 (not in lock, recorded in fingerprint): ${actual}`);
      }
    }

  const stageYtSize = stageYtExists ? statSync(stageYtDlpExe).size : 0;
  const stageMpv = dirSize(stageMpvDir);
  const beforeMpv = beforeSource.bytes || 0;

  const fingerprintPath = join(root, 'lightweight', 'resources', '.melo-runtime-fingerprint.json');
  if (stageYtExists || stageMpv.files > 0) {
    writeFileSync(fingerprintPath, JSON.stringify(fingerprint, null, 2) + '\n');
  }

  console.log(`source root      ${resolvedSourceRoot}`);
  console.log(`mpv before       ${(beforeMpv / 1024 / 1024).toFixed(2)} MiB (source, ${beforeSource.files} files)`);
  console.log(`mpv copied       ${mpvCounts.copied} files, dropped ${mpvCounts.dropped}`);
  console.log(`mpv staged       ${(stageMpv.bytes / 1024 / 1024).toFixed(2)} MiB (${stageMpv.files} files, ${dllCount} DLLs)`);
  console.log(`yt-dlp.exe       ${(stageYtSize / 1024 / 1024).toFixed(2)} MiB`);
  console.log(`runtime total    ${((stageMpv.bytes + stageYtSize) / 1024 / 1024).toFixed(2)} MiB`);
  console.log('──────────────────────────────────────────────────────────');
  if (expectedSha) console.log('yt-dlp sha256     verified');
  else console.log('yt-dlp sha256     fingerprint only (fill runtime.lock.json to pin)');
  console.log('runtime ready.');
}

main().catch((e) => {
  eprintln(e?.message || String(e));
  process.exit(1);
});
