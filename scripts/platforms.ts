export const PLATFORM_PACKAGES = [
  {
    target: 'bun-darwin-arm64',
    dir: 'darwin-arm64',
    binary: 'melo',
    name: 'melo-darwin-arm64',
  },
  {
    target: 'bun-darwin-x64',
    dir: 'darwin-x64',
    binary: 'melo',
    name: 'melo-darwin-x64',
  },
  {
    target: 'bun-linux-x64',
    dir: 'linux-x64',
    binary: 'melo',
    name: 'melo-linux-x64',
  },
  {
    target: 'bun-linux-arm64',
    dir: 'linux-arm64',
    binary: 'melo',
    name: 'melo-linux-arm64',
  },
  {
    target: 'bun-windows-x64',
    dir: 'win32-x64',
    binary: 'melo.exe',
    name: 'melo-win32-x64',
  },
] as const;
