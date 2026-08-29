export const PLATFORM_PACKAGES = [
  {
    target: 'bun-darwin-arm64',
    dir: 'darwin-arm64',
    binary: 'ytmusic-cli',
    name: '@mammadovziya/ytmusic-player-darwin-arm64',
  },
  {
    target: 'bun-darwin-x64',
    dir: 'darwin-x64',
    binary: 'ytmusic-cli',
    name: '@mammadovziya/ytmusic-player-darwin-x64',
  },
  {
    target: 'bun-linux-x64',
    dir: 'linux-x64',
    binary: 'ytmusic-cli',
    name: '@mammadovziya/ytmusic-player-linux-x64',
  },
  {
    target: 'bun-linux-arm64',
    dir: 'linux-arm64',
    binary: 'ytmusic-cli',
    name: '@mammadovziya/ytmusic-player-linux-arm64',
  },
  {
    target: 'bun-windows-x64',
    dir: 'win32-x64',
    binary: 'ytmusic-cli.exe',
    name: '@mammadovziya/ytmusic-player-win32-x64',
  },
] as const;
