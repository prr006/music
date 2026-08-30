import { mkdtemp, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PLATFORM_PACKAGES } from './platforms';

const root = join(import.meta.dir, '..');
const platformDir = `${process.platform}-${process.arch}`;
const platformPackage = PLATFORM_PACKAGES.find(platform => platform.dir === platformDir);

if (!platformPackage) {
  throw new Error(`No npm install smoke target for ${process.platform} ${process.arch}.`);
}

async function run(command: string[], options: { cwd?: string; env?: Record<string, string | undefined> } = {}) {
  const proc = Bun.spawn(command, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const [exitCode, output, errorOutput] = await Promise.all([proc.exited, stdout, stderr]);

  if (output) process.stdout.write(output);
  if (errorOutput) process.stderr.write(errorOutput);
  if (exitCode !== 0) {
    throw new Error(`${command.join(' ')} exited with code ${exitCode}.`);
  }

  return output.trim();
}

async function pack(directory: string, destination: string): Promise<string> {
  const output = await run([
    'npm',
    'pack',
    directory,
    '--silent',
    '--pack-destination',
    destination,
  ]);
  const filename = output.split('\n').at(-1);
  if (!filename) throw new Error(`npm pack did not return a filename for ${directory}.`);
  return join(destination, filename);
}

const temporaryPrefix = join(tmpdir(), 'melo-install-');
const temporaryDirectory = await mkdtemp(temporaryPrefix);

try {
  const platformTarball = await pack(join(root, 'npm', platformPackage.dir), temporaryDirectory);
  const rootTarball = await pack(root, temporaryDirectory);
  const installPrefix = join(temporaryDirectory, 'prefix');

  const installOutput = await run([
    'npm',
    'install',
    '--global',
    '--prefix',
    installPrefix,
    '--foreground-scripts',
    platformTarball,
    rootTarball,
  ], {
    env: {
      ...process.env,
      CI: '1',
      MELO_INSTALL_DRY_RUN: '1',
    },
  });

  if (!installOutput.includes('melo:')) {
    throw new Error('The MELO postinstall dependency setup did not run.');
  }

  const installedPackage = join(installPrefix, 'lib', 'node_modules', 'melo');
  await stat(join(installedPackage, 'scripts', 'install-runtime-deps.js'));

  const executable = process.platform === 'win32'
    ? join(installPrefix, 'melo.cmd')
    : join(installPrefix, 'bin', 'melo');
  const installedVersion = await run([executable, '--version']);
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

  if (installedVersion !== manifest.version) {
    throw new Error(`Installed CLI reported ${installedVersion}; expected ${manifest.version}.`);
  }

  process.stdout.write(`Verified clean npm install for ${platformPackage.name}.\n`);
} finally {
  if (temporaryDirectory.startsWith(temporaryPrefix)) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
