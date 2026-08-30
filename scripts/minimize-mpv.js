#!/usr/bin/env node
/**
 * Conservative analyzer for the bundled portable mpv distribution.
 *
 * It never deletes a DLL and it never deletes an executable or a "review"
 * file unless `--apply --allow-executable` is explicitly supplied.
 *
 * Usage:
 *   node scripts/minimize-mpv.js                     # dry run
 *   node scripts/minimize-mpv.js --mpv <dir>         # dry run on a dir
 *   node scripts/minimize-mpv.js --apply             # delete known-safe files only
 *
 * Before shipping, verify the remaining set:
 *   - DLL dependency walk (dumpbin /dependents or Dependencies.exe)
 *   - launch mpv --version --input-ipc-server=... from the pruned dir
 *   - play a local file and a YouTube stream from the packaged app
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const mpvArg = args.indexOf('--mpv');
const mpvDir = mpvArg >= 0
  ? resolve(args[mpvArg + 1])
  : resolve('lightweight', 'resources', 'bin', 'mpv');
const apply = args.includes('--apply');
const allowExecutable = args.includes('--allow-executable');

const docsExt = new Set(['.md', '.txt', '.rst', '.html', '.htm', '.changelog', '.changes']);
const installerPatterns = [
  /setup\.exe$/i,
  /install\.exe$/i,
  /uninstall/i,
  /update.*\.exe$/i,
  /registry/i,
  /register/i,
];
const updatePatterns = [/^.*\.(bat|cmd|ps1)$/i, /updater/i, /update\./i];

function classify(file) {
  const name = file.toLowerCase();
  if (/\.dll$/i.test(name)) return 'keep';
  if (/^mpv(\.exe|\.com)?$/i.test(name)) return 'keep';
  if (installerPatterns.some((r) => r.test(name))) return 'remove-safe';
  if (/^license|^copying|^readme/i.test(name)) return 'keep';
  const ext = name.includes('.') ? `.${name.split('.').pop()}` : '';
  if (docsExt.has(ext)) return 'remove-safe';
  if (updatePatterns.some((r) => r.test(name))) return 'remove-safe';
  if (/\.exe$/i.test(name)) return allowExecutable ? 'remove-safe' : 'review';
  if (/\.(reg|ini|conf)$/i.test(name)) return 'review';
  return 'review';
}

function walk(dir, rel = '') {
  let files = [];
  let bytes = 0;
  if (!existsSync(dir)) return { files, bytes };
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const childRel = rel ? `${rel}/${entry}` : entry;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      const sub = walk(full, childRel);
      files.push(...sub.files);
      bytes += sub.bytes;
    } else {
      files.push({ path: full, size: stat.size });
      bytes += stat.size;
    }
  }
  return { files, bytes };
}

const total = walk(mpvDir);
const removeSafe = [];
const review = [];
const keep = [];

for (const file of total.files) {
  const cls = classify(file.path);
  if (cls === 'remove-safe') removeSafe.push(file);
  else if (cls === 'review') review.push(file);
  else keep.push(file);
}

const sum = (arr) => arr.reduce((a, b) => a + b.size, 0);
const mi = (b) => `${(b / 1024 / 1024).toFixed(2)} MiB`;

console.log('── mpv minimization report ────────────────────────────────');
console.log(`dir: ${mpvDir}`);
console.log(`total            ${mi(total.bytes)} (${total.files.length} files)`);
console.log(`safe to remove   ${mi(sum(removeSafe))} (${removeSafe.length} files)`);
console.log(`review (manual)  ${mi(sum(review))} (${review.length} files)`);
console.log(`keep             ${mi(sum(keep))} (${keep.length} files)`);
console.log();

for (const f of removeSafe) console.log(`  safe  ${mi(f.size)}  ${f.path}`);
for (const f of review) console.log(`  review ${mi(f.size)}  ${f.path}`);

if (!apply) {
  console.log('\nDry run only. Re-run with --apply to delete safe files.');
  process.exit(0);
}

if (removeSafe.length > 0) {
  for (const f of removeSafe) {
    rmSync(f.path, { force: true });
  }
  console.log(`\nDeleted ${removeSafe.length} safe files.`);
}
console.log('No DLL or mpv component was deleted.');
