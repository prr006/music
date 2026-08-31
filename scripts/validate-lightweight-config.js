#!/usr/bin/env node
/**
 * Static validation for the Tauri lightweight MELO package.
 *
 * Usage: node scripts/validate-lightweight-config.js
 *
 * It verifies that the Tauri project is configured for the Windows/WebView2
 * path and that the package does not accidentally depend on Electron/Chromium.
 * It is intentionally build-independent: it does not require Rust or the bundled
 * runtime to be present.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lw = join(root, 'lightweight');
const srcTauri = join(lw, 'src-tauri');

const errors = [];
const warnings = [];

function readJson(path) {
  if (!existsSync(path)) {
    errors.push(`missing ${path}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    errors.push(`invalid JSON in ${path}: ${e.message}`);
    return null;
  }
}

const pkg = readJson(join(lw, 'package.json'));
const tauri = readJson(join(srcTauri, 'tauri.conf.json'));
const caps = readJson(join(srcTauri, 'capabilities', 'default.json'));
const cargo = existsSync(join(srcTauri, 'Cargo.toml'))
  ? readFileSync(join(srcTauri, 'Cargo.toml'), 'utf8')
  : '';

if (pkg) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const name of Object.keys(deps)) {
    if (/^electron$/i.test(name) || /electron-/.test(name)) {
      errors.push(`lightweight package must not depend on "${name}"`);
    }
  }
  if (!pkg.scripts?.['build:renderer']) warnings.push('missing build:renderer script');
  if (!pkg.scripts?.['package:lightweight']) warnings.push('missing package:lightweight script');
  if (!pkg.scripts?.['prepare:runtime']) warnings.push('missing prepare:runtime script');
  if (!pkg.scripts?.['typecheck']) warnings.push('missing typecheck script');
}

if (tauri) {
  const bundle = tauri.bundle || {};
  const targets = Array.isArray(bundle.targets) ? bundle.targets : [];
  if (!targets.includes('nsis')) errors.push('bundle.targets does not include nsis');
  if (bundle.resources && typeof bundle.resources !== 'object' && !Array.isArray(bundle.resources)) {
    errors.push('bundle.resources has an unexpected type');
  }
  const resources = bundle.resources;
  const sourceMapped = resources && typeof resources === 'object' && !Array.isArray(resources) && resources['../resources/bin/'];
  if (!sourceMapped) {
    errors.push('bundle.resources must map "../resources/bin/" -> "bin/" so the runtime lands at $RESOURCE/bin');
  }
  if (!bundle.icon || !Array.isArray(bundle.icon) || bundle.icon.length === 0) {
    errors.push('bundle.icon missing');
  }
  const windowsCfg = bundle.windows || {};
  const wim = windowsCfg.webviewInstallMode || {};
  const mode = (wim.type || '').toLowerCase();
  if (!mode) warnings.push('bundle.windows.webviewInstallMode.type missing; default is downloadBootstrapper');
  else if (mode !== 'downloadbootstrapper' && mode !== 'fixedruntime' && mode !== 'offlineinstaller' && mode !== 'embedbootstrapper') {
    warnings.push(`unexpected webviewInstallMode.type ${mode}`);
  }
  const nsis = windowsCfg.nsis || {};
  const installMode = (nsis.installMode || 'currentUser').toLowerCase();
  if (!['currentuser', 'permachine', 'both'].includes(installMode)) {
    errors.push(`bundle.windows.nsis.installMode "${nsis.installMode}" is invalid; use currentUser | perMachine | both`);
  }
  if (tauri.app?.withGlobalTauri !== true) errors.push('app.withGlobalTauri must be true for the bridge');
  const windowCount = tauri.app?.windows?.length || 0;
  if (windowCount === 0) errors.push('no window defined');
  else if (tauri.app.windows[0].label !== 'main') errors.push('main window label must be "main"');
}

if (caps) {
  const perms = caps.permissions || [];
  const required = [
    'core:window:default',
    'core:window:allow-close',
    'core:window:allow-minimize',
    'core:window:allow-maximize',
    'core:window:allow-unmaximize',
    'core:window:allow-hide',
    'core:window:allow-show',
    'core:window:allow-is-maximized',
    'core:window:allow-start-dragging',
  ];
  for (const perm of required) {
    if (!perms.includes(perm)) errors.push(`capability missing ${perm}`);
  }
}

if (!/tauri\s*=\s*\{[^}]*version\s*=\s*"2"/s.test(cargo)) {
  errors.push('Cargo.toml does not appear to depend on tauri 2');
}
if (!/tauri-plugin-single-instance/.test(cargo)) {
  errors.push('Cargo.toml missing tauri-plugin-single-instance');
}
if (!/tauri-build/.test(cargo)) {
  errors.push('Cargo.toml missing tauri-build');
}

if (errors.length > 0) {
  console.error('Lightweight config validation FAILED');
  for (const e of errors) console.error(`  ERROR: ${e}`);
  if (warnings.length > 0) {
    for (const w of warnings) console.warn(`  warning: ${w}`);
  }
  process.exit(1);
}

console.log('Lightweight config validation OK');
if (warnings.length > 0) {
  for (const w of warnings) console.log(`  warning: ${w}`);
}
