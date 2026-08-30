# MELO bundled runtime

The lightweight MELO package must be self-contained. Windows runtime binaries
are staged into `lightweight/resources/bin` by
`node scripts/prepare-lightweight-runtime.js`.

## Source of truth

The default source is the already-verified Electron runtime:

```
gui/resources/runtime/
  mpv/
    mpv.exe
    ...any DLLs actually loaded by mpv...
  yt-dlp.exe
```

You can pass a different source directory with `--from <dir>`. The preparer
never modifies the source tree. It copies:

- `yt-dlp.exe`
- `mpv/mpv.exe`
- `mpv/mpv.com` (kept as a conservative fallback)
- every DLL under `mpv/` (never dropped)
- root license/readme files

It intentionally drops documentation, installer/updater scripts, registration
helpers and unrelated executables. If you are unsure whether a file is needed,
keep it in the source directory under `mpv/` and re-run; unknown files are only
dropped when the classifier is certain.

## Required layout after staging

```
lightweight/resources/bin/
  mpv/
    mpv.exe
    ...any DLLs actually loaded by mpv...
  yt-dlp.exe
```

The Rust backend (see `lightweight/src-tauri/src/runtime.rs`) resolves these
in this order:

1. `MELO_MPV` / `MELO_YTDLP` environment overrides
2. directory next to the MELO executable
3. Tauri resource directory (`$RESOURCE/bin/...`)
4. source-tree `lightweight/resources/bin` during development

Do not symlink or shortcut these files. The packaged application is expected to
work when `mpv` and `yt-dlp` are removed from `PATH`; this is the final
acceptance check on the Windows host.

## Pinning

`lightweight/runtime.lock.json` holds the version and SHA-256. Production
packaging refuses to ship `yt-dlp.exe` while `yt-dlp.sha256` is empty. Fill it
after you verify and hash the exact binaries you intend to release.

## Why not commit them

The binaries are intentionally not committed to git. They are:
- large (~120 MB mpv portable + ~25 MB yt-dlp.exe)
- Windows-specific
- third-party and subject to their own licenses

Use a release pipeline to download/pin them and verify `yt-dlp.exe` against the
SHA-256 in `lightweight/runtime.lock.json`.
