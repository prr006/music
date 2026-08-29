# Changelog

## Unreleased

## v0.3.7

### New Features

- Add a per-user control socket with commands for playback, volume, seeking, status, queue, shuffle, repeat, favorites, downloads, and shutdown.
- Add `ym -s <song name>` and `ym play <song name>` shortcuts that control the running player or start one automatically.

### Fixes

- Install missing `mpv` and `yt-dlp` tools during npm installation, with first-launch fallback when lifecycle scripts are disabled.
- Publish native binaries under the maintainer npm scope so npm installs receive the current macOS, Linux, and Windows builds.
- Keep wrapper, binary, and optional dependency versions synchronized from the release tag.
- Allow slower first-time `mpv` startup and report its actual launch error when IPC setup fails.
- Reject stalled or failed `mpv` IPC commands instead of leaving the player hanging.
- Persist configuration writes synchronously and avoid unhandled download deletion errors.
- Add pull-request CI, native smoke builds, package tarball checks, and retry-safe releases.
- Surface `yt-dlp` process failures instead of silently treating them as empty search results.
- Repair the Homebrew formula repository URL, release version, and archive checksum.
- Prevent empty Favorites/Downloads navigation crashes and keep new playlist selection aligned.

## v0.3.6

### Fixes

- Fix Windows `mpv` launch by preferring `mpv.exe` over the `mpv.com` wrapper.

## v0.3.5

### New Features

- Add Windows support with named-pipe mpv IPC and Windows binary packaging.
- Add first-run dependency setup for `mpv` and `yt-dlp`.
- Add English, Azerbaijani, Turkish, Spanish, German, French, and Russian UI language support.

### Security & Privacy

- Run `yt-dlp` without user config, cache, cookies, or browser cookies.
- Run `mpv` without user config, disk cache, resume files, cookies, or watch history.
- Add optional `YTMUSIC_PROXY` routing for users who want to provide their own proxy.

### Docs

- Improve README SEO, platform support, release links, and privacy notes.

## v0.3.0

### New Features

- **Volume Control** — Press `+`/`=` to increase, `-`/`_` to decrease volume by 5 units. Current volume is displayed on the player screen.

### Fixes

- Fix search input hotkey handling on search screen

## v0.2.1

### Fixes

- Fix platform package resolution in bin script (use scoped package names)

## v0.2.0

### New Features

- **Previous Track** — Press `P` to go back to previously played tracks
- **Favorites** — Press `F` to toggle favorite, `L` to open favorites list. Favorites are persisted across sessions
- **Playlists** — Full playlist management:
  - Create, rename, and delete playlists
  - Add and remove tracks
  - Press `O` to open playlists from player or search screen
  - Press `A` to add current track to a playlist
- **Playlist Queue** — Playing a track from a playlist queues all playlist tracks, then continues with YouTube radio mix
- **Shuffle** — Press `X` to toggle shuffle mode for the queue
- **Search Screen Shortcuts** — Access favorites (`L`) and playlists (`O`) directly from the search screen

### Fixes

- Fix screen flicker on player refresh by using cursor home with line-level clearing

## v0.1.1

- Initial release with search, play, pause, seek, next track, and radio mix
