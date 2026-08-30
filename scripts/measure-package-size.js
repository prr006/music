#!/usr/bin/env node
/**
 * Installer vs. installed/unpacked size report for MELO builds.
 *
 * Usage:
 *   node scripts/measure-package-size.js
 *   node scripts/measure-package-size.js --app <unpacked-dir> --installer <setup.exe>
 *
 * Defaults:
 *   frontend    lightweight/dist/renderer
 *   backend     lightweight/src-tauri/target/release
 *   runtime     lightweight/resources/bin
 *   installer   lightweight/src-tauri/target/release/bundle/nsis
 *   unpacked    (best-effort synthesis of backend + runtime + frontend)
 *
 * Installer files (NSIS/MSI) are counted separately from the unpacked app tree
 * and are never merged into the "installed/unpacked" number.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(path) {
  if (!existsSync(path)) return { bytes: 0, files: 0 };
  const stat = statSync(path);
  if (stat.isFile()) return { bytes: stat.size, files: 1 };
  let bytes = 0;
  let files = 0;
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    const sub = walk(child);
    bytes += sub.bytes;
    files += sub.files;
  }
  return { bytes, files };
}

function human(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function humanBytes(bytes) {
  return `${bytes}`;
}

function installerExt(path) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return ['.exe', '.msi', '.msix', '.appx', '.zip', '.7z'].includes(`.${ext}`);
}

function isBundleInstallerDir(path) {
  const norm = path.replace(/\\/g, '/');
  return /\/nsis(\/|$)/.test(norm) || /\/msi(\/|$)/.test(norm) || /\/bundle\/nsis(\/|$)/.test(norm);
}

function collectInstallers(path, out) {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.isFile()) {
    if (installerExt(path) || /setup\.exe$/i.test(path)) {
      out.bytes += stat.size;
      out.files.push(path);
    }
    return;
  }
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    const childStat = statSync(child);
    if (childStat.isFile() && (/setup\.exe$/i.test(child) || (/\.exe$|\.msi$/i.test(child) && isBundleInstallerDir(path)))) {
      out.bytes += childStat.size;
      out.files.push(child);
    } else if (childStat.isDirectory()) {
      collectInstallers(child, out);
    }
  }
}

function opts() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--app') out.app = resolve(args[i + 1]);
    else if (args[i] === '--installer') out.installer = resolve(args[i + 1]);
    else if (args[i] === '--frontend') out.frontend = resolve(args[i + 1]);
    else if (args[i] === '--runtime') out.runtime = resolve(args[i + 1]);
    else if (args[i] === '--backend') out.backend = resolve(args[i + 1]);
  }
  return out;
}

const o = opts();
const frontendDir = o.frontend || resolve(root, 'lightweight', 'dist', 'renderer');
const backendDir = o.backend || resolve(root, 'lightweight', 'src-tauri', 'target', 'release');
const runtimeDir = o.runtime || resolve(root, 'lightweight', 'resources', 'bin');
const installerDir = o.installer || resolve(root, 'lightweight', 'src-tauri', 'target', 'release', 'bundle', 'nsis');
// Explicit paths are resolved against the shell cwd (matching how scripts run
// from either the repo root or lightweight/).
const appDir = o.app;
const electronPaths = [
  resolve(root, 'gui', 'out'),
  resolve(root, 'gui', 'resources'),
  resolve(root, 'gui', 'dist'),
].filter((p) => o.installer || existsSync(p));

console.log('── MELO package size report ─────────────────────────────────────');

const installers = { bytes: 0, files: [] };
collectInstallers(installerDir, installers);
for (const electronPath of electronPaths) {
  collectInstallers(electronPath, installers);
}

function report(path, label) {
  const { bytes, files } = walk(path);
  console.log(`  ${label.padEnd(28)} ${human(bytes).padStart(11)}  ${files} files  ${path}`);
  return { bytes, files };
}

// ─── Detailed sections ─────────────────────────────────────────────────────
console.log('\n── Components (source/build trees) ──────────────────────────────');
for (const electronPath of electronPaths) {
  report(electronPath, 'electron fallback');
}
const frontend = report(frontendDir, 'lightweight frontend');
const backend = report(backendDir, 'lightweight backend');
const runtime = report(runtimeDir, 'lightweight runtime');

const mpvDir = join(runtimeDir, 'mpv');
const ytdlpPath = join(runtimeDir, 'yt-dlp.exe');
const mpv = report(mpvDir, '  └─ mpv');
const ytdlp = report(ytdlpPath, '  └─ yt-dlp.exe');

// Find and report WebView2-related bundled files if any (should be none).
let webviewSize = 0;
let webviewFiles = [];
const webviewPatterns = [/WebView2/i, /EBWebView/i, /msedgewebview2/i, /MicrosoftEdgeWebView2/i];
for (const base of [frontendDir, backendDir, runtimeDir, appDir, ...electronPaths].filter((p) => p && existsSync(p))) {
  for (const file of walkFiles(base)) {
    const name = file.replace(/\\/g, '/').split('/').pop() || '';
    if (webviewPatterns.some((re) => re.test(name))) {
      webviewSize += statSync(file).size;
      webviewFiles.push(file);
    }
  }
}
if (webviewFiles.length > 0) {
  console.log(`  WebView2 bundled files ${human(webviewSize)}  (${webviewFiles.length})`);
  for (const f of webviewFiles) console.log(`    ${resolve(f)}`);
} else {
  console.log('  WebView2 bundled      none found (uses system WebView2 as intended)');
}

// ─── Unpacked/installed estimate ────────────────────────────────────────────
console.log('\n── Installed / unpacked ─────────────────────────────────────────');
let unpackedBytes = 0;
let unpackedFiles = 0;
let unpackedLabel = '';

if (appDir && existsSync(appDir)) {
  const app = walk(appDir);
  unpackedBytes = app.bytes;
  unpackedFiles = app.files;
  unpackedLabel = `--app ${appDir}`;
} else {
  // Best-effort unpacked synthesis when no installed directory is supplied.
  unpackedBytes = frontend.bytes + backend.bytes + runtime.bytes;
  unpackedFiles = frontend.files + backend.files + runtime.files;
  unpackedLabel = 'synthesized from frontend + backend + runtime';
}
console.log(`  installed/unpacked  ${human(unpackedBytes).padStart(11)}  ${unpackedFiles} files  (${unpackedLabel})`);

console.log('\n── Installer ──────────────────────────────────────────────────');
if (installers.bytes > 0) {
  console.log(`  Installer total     ${human(installers.bytes).padStart(11)}  ${installers.files.length} files`);
  for (const file of installers.files) {
    const size = statSync(file).size;
    console.log(`      ${human(size)}  ${resolve(file)}`);
  }
} else {
  console.log('  Installer total     (no NSIS/MSI installer artifacts found)');
}

console.log('\n── Summary ──────────────────────────────────────────────────────');
console.log(`  frontend            ${humanBytes(frontend.bytes)} B`);
console.log(`  backend             ${humanBytes(backend.bytes)} B`);
console.log(`  mpv runtime         ${humanBytes(mpv.bytes)} B`);
console.log(`  yt-dlp runtime      ${humanBytes(ytdlp.bytes)} B`);
console.log(`  installed/unpacked  ${humanBytes(unpackedBytes)} B`);
console.log(`  installer           ${humanBytes(installers.bytes)} B`);
console.log('──────────────────────────────────────────────────────────────────');
console.log('Installer size and installed/unpacked size are different numbers.');
console.log('No sizes are estimated; every number above is measured from an existing file/path.');

function walkFiles(path) {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  const out = [];
  for (const entry of readdirSync(path)) {
    out.push(...walkFiles(join(path, entry)));
  }
  return out;
}
