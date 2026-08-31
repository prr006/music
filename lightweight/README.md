# MELO desktop build (Tauri)

The MELO desktop application: a Windows-first Tauri 2 app that reuses the
React/TypeScript renderer from `../gui/src/renderer`, runs `mpv` and `yt-dlp`
as child processes from a Rust backend, and uses the system WebView2 runtime
instead of shipping Chromium.

## Prerequisites (Windows build host)

- Rust stable (`rustup`)
- Node.js/npm
- WebView2 Runtime (normally present on Windows 10/11)
- Bundled runtime in `resources/bin` (see below)

## Setup

```bash
# From the repository root
cd lightweight
npm install
node ../scripts/validate-lightweight-config.js
node ../scripts/prepare-lightweight-runtime.js   # copies from lightweight/resources/runtime
npm run dev
```

`prepare-lightweight-runtime.js` is the single place that stages the Windows
runtime into `lightweight/resources/bin`. Its default source is the verified
desktop runtime directory `lightweight/resources/runtime` (populated by
`bun scripts/fetch-desktop-runtime.ts`); it never modifies that source tree:

```bash
node ../scripts/prepare-lightweight-runtime.js                          # production: verifies yt-dlp SHA-256
node ../scripts/prepare-lightweight-runtime.js --from <dir>             # use a different source dir
node ../scripts/prepare-lightweight-runtime.js --allow-unpinned         # dev only; skips pin checks
```

Before release packaging, fill `lightweight/runtime.lock.json`:
- `yt-dlp.version` + `yt-dlp.url`
- `yt-dlp.sha256` (production mode fails while this is empty when `yt-dlp.exe` has been staged)
- `mpv.version` + `mpv.url` for the exact distribution used

During development, if bundled binaries are not yet present, use
`--allow-unpinned` and the backend can fall back to `mpv` / `yt-dlp` on `PATH`.
Do not ship that extra `--allow-unpinned` flag.

## Packaging

```bash
# From the repository root
npm run package:lightweight
```

`package:lightweight` runs:
1. `prepare:runtime` (stage + SHA-256 verification for `yt-dlp.exe`)
2. `validate` (Tauri config / NSIS / capabilities checks)
3. `build:renderer` (Vite build of the shared renderer)
4. `tauri build` (NSIS installer)

## Layout

- `src-tauri` — Rust backend (mpv IPC + yt-dlp + persistence + command surface)
- `resources/bin` — bundled `mpv` and `yt-dlp.exe` (git-ignored)
- `dist/renderer` — Vite output of the shared renderer
- `runtime.lock.json` — pinned `yt-dlp` / `mpv` version and SHA-256

## Runtime resolution

The Rust backend resolves the bundled runtime in this order:

1. `MELO_MPV` / `MELO_YTDLP` environment overrides
2. directory next to the MELO executable
3. Tauri resource directory (`$RESOURCE/bin/...`)
4. source-tree `lightweight/resources/bin` during development

`mpv` is started with the bundled `yt-dlp` directory prepended to `PATH` for the
child process only, so the packaged app does not depend on `mpv` or `yt-dlp`
being installed system-wide.

## Size

Run:

```bash
node ../scripts/measure-package-size.js
```

This reports installed/unpacked size and installer (NSIS/MSI) size separately.
The report only measures paths that already exist; it does not estimate missing
artifacts.
