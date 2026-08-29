import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ControlCommand } from '../src/cli';
import { ControlServer } from '../src/control';
import { PLATFORM_PACKAGES } from './platforms';

const root = join(import.meta.dir, '..');
const platformPackage = PLATFORM_PACKAGES.find(platform => platform.dir === `${process.platform}-${process.arch}`);
if (!platformPackage) throw new Error(`No CLI control smoke target for ${process.platform} ${process.arch}.`);

const temporaryPrefix = join(tmpdir(), 'ytmusic-player-control-cli-');
const temporaryDirectory = await mkdtemp(temporaryPrefix);
const socketPath = process.platform === 'win32'
  ? `\\\\.\\pipe\\ytmusic-player-control-cli-${process.pid}`
  : join(temporaryDirectory, 'control.sock');
const binaryPath = join(root, 'npm', platformPackage.dir, 'bin', platformPackage.binary);
const received: ControlCommand[] = [];
const server = new ControlServer(command => {
  received.push(command);
  if (command.type === 'next') return { ok: false, message: 'The queue is empty.' };
  if (command.type === 'play') return { ok: true, message: `Playing: ${command.query}` };
  return { ok: true, message: `Received: ${command.type}` };
}, socketPath);

async function run(args: string[], expectedExitCode = 0): Promise<string> {
  const proc = Bun.spawn([binaryPath, ...args], {
    env: { ...process.env, YTMUSIC_CONTROL_SOCKET: socketPath },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const [exitCode, output, errorOutput] = await Promise.all([proc.exited, stdout, stderr]);
  if (exitCode !== expectedExitCode) {
    throw new Error(`${binaryPath} ${args.join(' ')} exited ${exitCode}: ${errorOutput.trim()}`);
  }
  return (output || errorOutput).trim();
}

try {
  await server.start();

  if (await run(['status']) !== 'Received: status') {
    throw new Error('The compiled status command returned an unexpected response.');
  }
  if (await run(['-s', 'alors', 'on', 'danse']) !== 'Playing: alors on danse') {
    throw new Error('The compiled search command returned an unexpected response.');
  }
  if (await run(['next'], 1) !== 'The queue is empty.') {
    throw new Error('The compiled CLI did not preserve a control error response.');
  }

  const expected: ControlCommand[] = [
    { type: 'status' },
    { type: 'play', query: 'alors on danse' },
    { type: 'next' },
  ];
  if (JSON.stringify(received) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected control commands: ${JSON.stringify(received)}`);
  }

  process.stdout.write(`Verified compiled CLI control for ${platformPackage.name}.\n`);
} finally {
  await server.stop();
  if (temporaryDirectory.startsWith(temporaryPrefix)) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
