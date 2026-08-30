export interface VersionProbeResult {
  binary: string;
  version: string | null;
}

export type VersionRunner = (binary: string, args: string[]) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export async function probeBinaryVersion(
  binary: string,
  run: VersionRunner = defaultVersionRunner,
): Promise<string | null> {
  if (!binary) return null;
  try {
    const result = await run(binary, ['--version']);
    if (result.exitCode !== 0) return null;
    const line = result.stdout.trim().split(/\r?\n/).find(Boolean)
      || result.stderr.trim().split(/\r?\n/).find(Boolean);
    return line || null;
  } catch {
    return null;
  }
}

async function defaultVersionRunner(binary: string, args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn([binary, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}
