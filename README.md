# MELO — lightweight desktop music player

MELO is a fast, private YouTube Music desktop player for Windows. It is a
lightweight [Tauri 2](https://tauri.app) application: a small native shell
around the system WebView2 runtime, a Rust backend, and a React/TypeScript
frontend. Audio is streamed through `mpv` with metadata, search, and downloads
handled by `yt-dlp`.

[![CI](https://github.com/prr006/music/actions/workflows/ci.yml/badge.svg)](https://github.com/prr006/music/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Why MELO

- **Lightweight** — uses the WebView2 runtime already on Windows; no bundled Chromium.
- **Native playback** — `mpv` drives audio with low overhead and precise seeking.
- **Offline downloads** — `yt-dlp` saves songs under your Music folder.
- **Private** — no analytics, telemetry, accounts, or browser cookies.
- **Familiar UI** — favorites, playlists, queue, shuffle, repeat, lyrics, and volume controls.

## Architecture

| Component | Technology |
| :--- | :--- |
| Shell | Tauri 2 (`lightweight/src-tauri`) |
| Webview | WebView2 (system runtime) |
| Renderer | React/TypeScript (`gui/src/renderer`) |
| Backend | Rust (mpv IPC + yt-dlp + persistence) |
| Playback | `mpv` (bundled) |
| Metadata/search | `yt-dlp` (bundled) |

The Rust backend keeps `mpv` and `yt-dlp` as child processes and talks to `mpv`
over its IPC socket/named pipe. The renderer reuses the shared React UI and
communicates with the backend through a Tauri bridge exposing the same
`window.api` command/event surface the UI expects.

## Requirements

- Windows 10/11 with the WebView2 Runtime (normally preinstalled).
- A Windows build host with Rust (`rustup`) and Node.js/npm to build from source.

The packaged app is self-contained: `mpv` and `yt-dlp` are bundled and do not
need to be installed system-wide.

## Development

```bash
# from lightweight/
npm install
npm run dev             # starts Vite + `tauri dev`
npm run typecheck       # type-checks the shared renderer
npm run validate        # validates Tauri config / NSIS / capabilities
```

The renderer lives in `gui/src/renderer` and is shared with the Tauri build via
`lightweight/vite.config.ts`.

### Bundled runtime

The Windows `mpv` and `yt-dlp` binaries are downloaded and pinned, never
committed to git:

```bash
bun scripts/fetch-desktop-runtime.ts           # downloads to lightweight/resources/runtime
node scripts/prepare-lightweight-runtime.js     # stages into lightweight/resources/bin
```

See `lightweight/README.md` and `lightweight/resources/README.md` for details on
pinning and SHA-256 verification.

## Packaging

```bash
npm run package:lightweight    # builds the Windows NSIS installer
```

## Privacy

- No analytics, telemetry, accounts, or browser cookies.
- `yt-dlp` runs with config, filesystem cache, and cookie loading disabled.
- `mpv` runs with user config, disk cache, resume files, cookies, and watch history disabled.

## Data directory

Library files live in `%APPDATA%\melo`. Downloads live in `%USERPROFILE%\Music\melo`.

## License

MIT. See `LICENSE` for details.
