---
title: Releasing a New Version
tags:
  - kb
  - devops
---

# Releasing a New Version

## Overview

Releases are automated via GitHub Actions. Pushing a version tag triggers a workflow that builds binaries for all platforms and publishes them to npm.

## Steps

### 1. Make sure everything works locally

```sh
bun ci
bun run typecheck
bun test
```

The same checks run on every pull request through GitHub Actions. CI also smoke-builds native binaries on Linux, macOS, and Windows.

### 2. Bump the version

Update the root package, every native package, and the root optional dependency versions together:

```sh
bun run set-version 0.x.x
bun run check:packaging
```

Native packages use the `@mammadovziya` npm scope. Keeping them scoped prevents npm package-name similarity checks from rejecting the release.

### 3. Build all platform binaries

```sh
bun run build
bun run check:tarballs
bun run check:control-cli
bun run check:npm-install
```

Verify the output:

```
npm/darwin-arm64/bin/ytmusic-cli
npm/darwin-x64/bin/ytmusic-cli
npm/linux-x64/bin/ytmusic-cli
npm/linux-arm64/bin/ytmusic-cli
npm/win32-x64/bin/ytmusic-cli.exe
```

### 4. Commit and push

```sh
git add .
git commit -m "chore: release v0.x.x"
git push origin main
```

### 5. Push a version tag

This is what triggers the GitHub Actions release workflow.

```sh
git tag v0.x.x
git push origin v0.x.x
```

The workflow will:

1. Build binaries for all platforms
2. Publish each platform package to npm
3. Publish the main `ytmusic-player` package to npm

### 6. Verify the release

```sh
npm info ytmusic-player
npm info @mammadovziya/ytmusic-player-darwin-arm64
```

Check that the main package and every scoped platform package report the version you just published. Also install the package in a clean temporary environment and run `ym --version`.

Confirm the main package's `postinstall` output installs missing `mpv` and `yt-dlp` tools. Repeat once with `npm install -g --ignore-scripts ytmusic-player` and verify that first launch performs the fallback setup.

Update `Formula/ytmusic-cli.rb` to the new GitHub tag and replace its SHA256 with the checksum of that release archive before updating the Homebrew tap.

## Manual publishing (if needed)

If the workflow fails, you can publish manually:

```sh
bun run build

cd npm/darwin-arm64 && npm publish --access public && cd ../..
cd npm/darwin-x64 && npm publish --access public && cd ../..
cd npm/linux-x64 && npm publish --access public && cd ../..
cd npm/linux-arm64 && npm publish --access public && cd ../..
cd npm/win32-x64 && npm publish --access public && cd ../..

npm publish --access public
```

## Notes

- Platform packages must be published **before** the main package.
- All packages must share the same version number.
- Run `bun run check:packaging` before publishing so the wrapper and native package names cannot drift.
- Run `bun run check:tarballs` after building to verify every published archive contains its executable.
- Run `bun run check:control-cli` after building to verify the compiled CLI can send commands through the control socket.
- Run `bun run check:npm-install` after building to verify the wrapper, native package, dependency lifecycle, and CLI version together.
- Release publishing is retry-safe: versions already present on npm are skipped, while missing packages continue publishing.
- The `NPM_TOKEN` secret must be set in GitHub repository settings under **Settings → Secrets and variables → Actions**.
