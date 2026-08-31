# MELO Lightweight Architecture Migration

Status: **implementation scaffold on the working branch**. The Electron
application is untouched and remains the fallback. The lightweight Tauri 2
build is created alongside it as `lightweight/`. The shared renderer now builds
successfully with Vite in this sandbox, the Tauri config parses under
`tauri info`, and config/type validation passes. The Rust backend and the NSIS
package still need to be compiled and exercised on a Windows host.

## Important environment caveat

This checkout does **not** contain the Electron packaging outputs
(`gui/out`, `gui/resources`, `backend-headless.exe`) or the bundled
`mpv` / `yt-dlp` binaries. Those artifacts are git-ignored and are not present
in the source snapshot. Therefore:

- The requested **exact 537 MB baseline breakdown cannot be produced from this
  checkout**; it requires running the size report on the machine that has the
  Electron build (`npm run measure:package-size` after the Electron package is
  built).
- The lightweight build **cannot be compiled or exercised on Windows inside this
  Linux sandbox** (no Rust/Cargo, no WebView2, no packaged runtime). The code
  path is ready for a Windows host with the Tauri prerequisites.

## Chosen architecture

- **Shell**: Tauri 2 (`lightweight/src-tauri`), Windows target.
- **Webview**: WebView2 (system Chromium). No Chromium is bundled.
- **Renderer**: the existing `gui/src/renderer` React/TypeScript UI, reused by
  Vite through `lightweight/vite.config.ts`. No UI redesign.
- **Bridge**: `gui/src/renderer/tauri-bridge.ts` installs the identical
  `window.api` surface on `window.__TAURI__`; it is a no-op in Electron, so the
  existing preload path is unaffected.
- **Backend**: Rust inside the Tauri process (`engine`, `mpv`, `ytdlp`, `config`,
  `runtime`, `commands`). It keeps `mpv` and `yt-dlp` as child processes and
  speaks to `mpv` over its IPC socket/named pipe. The compiled Bun backend is
  not packaged in the lightweight target.
- **Data**: reuse the existing `%APPDATA%\melo\*.json` formats
  (`settings.json`, `favorites.json`, `playlists.json`, `downloads.json`), so
  favorites/playlists/downloads are shared with the Electron build.

## Current Electron size (baseline)

Cannot be measured in this checkout because the packaged artifacts are not
present. The expected contributors are listed for the report to fill on the
machine that has the build:

| Component | Expected contribution | Source |
|---|---|---|
| Electron runtime / Chromium | roughly 230–300 MB unpacked | Electron package |
| Bun-compiled backend | backend-headless.exe | gui/resources |
| mpv portable distribution | roughly 100–120 MB unpacked | bundled runtime |
| yt-dlp.exe | roughly 25 MB | bundled runtime |
| React UI + assets | tens of MB | gui/out |
| NSIS installer | usually smaller than unpacked | electron-builder |

Run `node scripts/measure-package-size.js` after building to fill in real values.

## Milestone size measurement plan

Measure both **installer size** and **installed/unpacked size**. The two numbers
are different and are never conflated.

| Milestone | How | Expected |
|---|---|---|
| 1. Tauri shell alone | `frontendDist: "../dist/renderer"` empty placeholder | Rust binary + WebView2 runtime (system) |
| 2. Tauri + React UI | `lightweight/dist/renderer` | small incremental UI bundle |
| 3. Native backend | Rust `melo-lightweight.exe` | small incremental |
| 4. + yt-dlp | `lightweight/resources/bin/yt-dlp.exe` | + ~25 MB |
| 5. + current mpv | `lightweight/resources/bin/mpv` | + ~120 MB |
| 6. + minimized mpv | `scripts/minimize-mpv.js --apply --allow-executable` after verification | reduced |
| 7. Windows NSIS installer | `target/release/bundle/nsis` | reported separately |

Use `node scripts/measure-package-size.js` for the unpacked total and the
installer total, and report both in the release notes.

## Files added / changed

Added:
- `lightweight/package.json`
- `lightweight/vite.config.ts`
- `lightweight/tsconfig.json`
- `lightweight/README.md`
- `lightweight/runtime.lock.json`
- `lightweight/resources/README.md`
- `lightweight/src-tauri/Cargo.toml`
- `lightweight/src-tauri/build.rs`
- `lightweight/src-tauri/tauri.conf.json`
- `lightweight/src-tauri/capabilities/default.json`
- `lightweight/src-tauri/src/main.rs`
- `lightweight/src-tauri/src/lib.rs`
- `lightweight/src-tauri/src/types.rs`
- `lightweight/src-tauri/src/config.rs`
- `lightweight/src-tauri/src/runtime.rs`
- `lightweight/src-tauri/src/mpv.rs`
- `lightweight/src-tauri/src/ytdlp.rs`
- `lightweight/src-tauri/src/engine.rs`
- `lightweight/src-tauri/src/commands.rs`
- `docs/lightweight-migration.md`
- `scripts/measure-package-size.js`
- `scripts/prepare-lightweight-runtime.js`
- `scripts/validate-lightweight-config.js`
- `scripts/minimize-mpv.js`

Changed (without breaking Electron):
- `gui/src/renderer/main.tsx` now imports the Tauri bridge before rendering. It
  is a no-op in Electron.
- `gui/src/renderer/tauri-bridge.ts` (new shared bridge).
- `gui/src/renderer/components/TitleBar.tsx` adds `data-tauri-drag-region` to
  the frameless window drag area (no-op for Electron).
- `gui/src/renderer/index.html` allows the Tauri IPC origin in CSP
  (`ipc:` / `http://ipc.localhost`); Electron is unaffected.
- `gui/package.json` adds `package:electron` and `package:lightweight`; the
  existing `package` script is unchanged.
- root `package.json` adds convenience scripts.
- `knowledge-base/Manual Test Checklist.md` gains the lightweight Windows test
  checklist.
- `.gitignore` ignores lightweight build output and runtime binaries.

The shared backend protocol already contains `move-queue` and all playlist /
settings / lyrics command variants on `main`; the lightweight Rust backend
implements that surface directly. No changes were needed to shared command
types or the Electron fallback path for this work.

## IPC/API surface recreated

The Rust backend exposes the same command/event names the renderer already
uses:

- `backend_send(command)` — search, play-track, next/previous, stop, queue,
  move-queue/remove-from-queue/play-next/play-from-queue, favorites, volume,
  seek, shuffle, repeat, get-state, get-queue, subscribe, quit,
  playlist/delete/rename/add/remove/reorder/play, save-queue-as-playlist,
  clear-history, get/save-settings, get-lyrics.
- `backend_is_connected`, `backend_get_connection_state`, `backend_retry`.
- Events: `backend:event`, `backend:connection-state`, `backend:connected`.

The old lightweight aliases (`queue-move`, `playlist-create`,
`playlist-*-track`, `playlist-apply`) are retained for compatibility.

## mpv strategy

- mpv remains the playback engine, used via IPC (`--input-ipc-server`).
- `lightweight/src-tauri/src/runtime.rs` resolves the bundled mpv.exe first.
- `scripts/minimize-mpv.js` is conservative: it never deletes a DLL and does
  not delete executable files unless `--allow-executable` is passed. Verify DLL
  dependencies and real playback before removing anything.

## yt-dlp strategy

- Keep the standalone Windows `yt-dlp.exe` in
  `lightweight/resources/bin/yt-dlp.exe`.
- `scripts/prepare-lightweight-runtime.js` refuses a production package unless
  `runtime.lock.json` has a pinned version and SHA-256 matching the bundled
  binary.
- The Rust backend resolves the bundled binary first and falls back only to
  development PATH use when no bundled copy exists.

## Runtime lifecycle

- Single-instance behavior via `tauri-plugin-single-instance`.
- mpv child starts with the Rust process and is killed on `RunEvent::Exit`
  (plus `kill_on_drop(true)` as a safety net).
- `backend:connection-state` tracks starting/connected/error.
- Close (X) is intercepted and hides to tray; tray “Quit” performs real
  shutdown.
- Playback state is polled every 500 ms and emitted as `playback-state`.
- Stale-load protection is carried by `mix_generation`: radio mixes accepted
  only for the generation that started the play request.

## Validation checklist (to run on Windows)

- [ ] Build `npm --prefix lightweight run package:lightweight` with rustup/cargo
  + `npm run prepare:runtime` + WebView2 present.
- [ ] Launches with no Electron process.
- [ ] No Python/system yt-dlp required.
- [ ] `mpv` and `yt-dlp` removed from `PATH`; app still resolves bundled copies.
- [ ] Search works.
- [ ] Playback works; mpv is the engine.
- [ ] Next/previous, stop-before-resolve, stale-load protection.
- [ ] Queue add/play-next/remove/reorder.
- [ ] Favorites and history/library.
- [ ] Playlists and settings persistence.
- [ ] Lyrics surface (currently returns an empty/absent result; real lyric
  parsing is out of scope for this migration).
- [ ] Shuffle/repeat, volume/seek.
- [ ] Keyboard shortcuts, media keys, tray. Mini-player APIs no-op in the
  lightweight shell (the separate mini window is not implemented yet).
- [ ] Close hides to tray; quit cleans up mpv/yt-dlp children.

## Remaining blockers

1. **Windows build/test host required.** This sandbox is Linux and has no
   Rust, no WebView2, and no packaged runtime, so the lightweight build has not
   been compiled or run.
2. **Bundled runtime absent.** Place `mpv.exe` + verified DLLs and the pinned
   `yt-dlp.exe` in `lightweight/resources/bin`.
3. **Baseline size report not measurable.** Run
   `node scripts/measure-package-size.js` after the Electron build exists.
4. **The separate Tauri mini window and actual timed-lyrics retrieval are not
   implemented yet.** The bridge exposes no-op mini-player methods and the
   backend returns an empty lyrics result, so the shared UI does not crash; real
   functionality is a follow-up.
5. **The Rust backend is untested source.** It follows the existing engine
   semantics and control protocol, but it needs `cargo check`, Windows build,
   and smoke testing before it is considered proven.
