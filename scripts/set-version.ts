import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { PLATFORM_PACKAGES } from './platforms';

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  process.stderr.write('Usage: bun scripts/set-version.ts <semver>\n');
  process.exit(1);
}

const root = join(import.meta.dir, '..');

async function readManifest(path: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeManifest(path: string, manifest: Record<string, any>) {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

const rootManifestPath = join(root, 'package.json');
const rootManifest = await readManifest(rootManifestPath);

rootManifest.version = version;
rootManifest.optionalDependencies = Object.fromEntries(
  PLATFORM_PACKAGES.map(platform => [platform.name, version])
);

await writeManifest(rootManifestPath, rootManifest);

for (const platform of PLATFORM_PACKAGES) {
  const manifestPath = join(root, 'npm', platform.dir, 'package.json');
  const manifest = await readManifest(manifestPath);
  manifest.name = platform.name;
  manifest.version = version;
  await writeManifest(manifestPath, manifest);
}

process.stdout.write(`Set all package versions to ${version}.\n`);
