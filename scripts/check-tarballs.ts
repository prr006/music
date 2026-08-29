import { join } from 'path';
import { PLATFORM_PACKAGES } from './platforms';

const root = join(import.meta.dir, '..');

async function inspectPackage(directory: string, expectedFiles: string[]) {
  const proc = Bun.spawn(['npm', 'pack', '--dry-run', '--json'], {
    cwd: directory,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const [exitCode, output, errorOutput] = await Promise.all([proc.exited, stdout, stderr]);

  if (exitCode !== 0) {
    throw new Error(`npm pack failed in ${directory}: ${errorOutput.trim()}`);
  }

  const packResult = JSON.parse(output)[0];
  const files = new Set<string>(packResult.files.map((file: { path: string }) => file.path));

  for (const expected of expectedFiles) {
    if (!files.has(expected)) {
      throw new Error(`${packResult.name}@${packResult.version} is missing ${expected}`);
    }
  }

  process.stdout.write(`Verified ${packResult.name}@${packResult.version}\n`);
}

await Promise.all([
  inspectPackage(root, ['bin/ytmusic-cli', 'scripts/install-runtime-deps.js', 'README.md', 'LICENSE']),
  ...PLATFORM_PACKAGES.map(platform =>
    inspectPackage(join(root, 'npm', platform.dir), ['index.js', `bin/${platform.binary}`])
  ),
]);
