import { mkdir } from 'fs/promises';
import { join } from 'path';
import { PLATFORM_PACKAGES } from './platforms';

const root = join(import.meta.dir, '..');

for (const { target, dir, binary } of PLATFORM_PACKAGES) {
  const outDir = join(root, 'npm', dir, 'bin');
  const outFile = join(outDir, binary);

  await mkdir(outDir, { recursive: true });

  process.stdout.write(`Building ${target}... `);

  const result = await Bun.$`bun build --compile --target=${target} ${join(root, 'src/index.ts')} --outfile=${outFile}`.quiet();

  if (result.exitCode !== 0) {
    process.stderr.write(`FAILED\n${result.stderr.toString()}\n`);
    process.exit(1);
  }

  process.stdout.write(`done -> npm/${dir}/bin/${binary}\n`);
}

console.log('\nAll platforms built.');
