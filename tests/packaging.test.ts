import { describe, expect, test } from 'bun:test';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { PLATFORM_PACKAGES } from '../scripts/platforms';

const root = join(import.meta.dir, '..');
const rootManifest = await readJson(join(root, 'package.json'));

async function readJson(path: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(path, 'utf8'));
}

describe('npm platform packages', () => {
  test('the wrapper depends on every scoped native package', () => {
    const expected = Object.fromEntries(
      PLATFORM_PACKAGES.map(platform => [platform.name, rootManifest.version])
    );

    expect(rootManifest.optionalDependencies).toEqual(expected);
  });

  for (const platform of PLATFORM_PACKAGES) {
    test(`${platform.dir} metadata matches the wrapper`, async () => {
      const manifest = await readJson(join(root, 'npm', platform.dir, 'package.json'));

      expect(manifest.name).toBe(platform.name);
      expect(manifest.version).toBe(rootManifest.version);
      expect(manifest.files).toContain('bin/');
    });
  }

  test('the launcher resolves packages from the maintainer scope', async () => {
    const launcher = await readFile(join(root, 'bin', 'ytmusic-cli'), 'utf8');
    expect(launcher).toContain('`@mammadovziya/ytmusic-player-${platformDir}`');
  });

  test('the wrapper ships and runs its dependency installer', () => {
    expect(rootManifest.scripts.postinstall).toBe('node scripts/install-runtime-deps.js');
    expect(rootManifest.files).toContain('scripts/install-runtime-deps.js');
  });
});
