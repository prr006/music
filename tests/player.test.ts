import { describe, expect, test } from 'bun:test';
import { MpvPlayer } from '../src/melo/playback/mpv-player';

interface PlayerInternals {
  socket: { destroyed: boolean; write: (data: string) => void } | null;
  command: (...args: unknown[]) => Promise<unknown>;
  onData: (data: string) => void;
  snapshot: MpvPlayer['snapshot'];
}

function withFakeSocket(player: MpvPlayer) {
  const writes: string[] = [];
  const internals = player as unknown as PlayerInternals;
  internals.socket = {
    destroyed: false,
    write(data) { writes.push(data); },
  };
  return { internals, writes };
}

describe('mpv IPC requests', () => {
  test('rejects immediately when no IPC connection exists', async () => {
    const player = new MpvPlayer();
    await expect(player.command('get_property', 'volume')).rejects.toThrow('not available');
  });

  test('resolves a successful mpv response', async () => {
    const { internals, writes } = withFakeSocket(new MpvPlayer());
    const response = internals.command('get_property', 'volume');
    const request = JSON.parse(writes[0]!);

    internals.onData(`${JSON.stringify({ request_id: request.request_id, error: 'success', data: 42 })}\n`);

    await expect(response).resolves.toMatchObject({ data: 42 });
  });

  test('rejects an mpv command error', async () => {
    const { internals, writes } = withFakeSocket(new MpvPlayer());
    const response = internals.command('bad-command');
    const request = JSON.parse(writes[0]!);

    internals.onData(`${JSON.stringify({ request_id: request.request_id, error: 'invalid parameter' })}\n`);

    await expect(response).rejects.toThrow('invalid parameter');
  });

  test('tracks mute property updates', () => {
    const player = new MpvPlayer();
    const { internals } = withFakeSocket(player);
    internals.onData(`${JSON.stringify({ event: 'property-change', name: 'mute', data: true })}\n`);
    expect(player.snapshot.muted).toBeTrue();
  });

  test('sets pause and volume state after successful commands', async () => {
    const player = new MpvPlayer();
    const { internals, writes } = withFakeSocket(player);

    const pause = player.setPaused(true);
    const pauseRequest = JSON.parse(writes[0]!);
    internals.onData(`${JSON.stringify({ request_id: pauseRequest.request_id, error: 'success' })}\n`);
    await pause;

    const setVolume = player.setVolume(42);
    const volumeRequest = JSON.parse(writes[1]!);
    internals.onData(`${JSON.stringify({ request_id: volumeRequest.request_id, error: 'success' })}\n`);
    await setVolume;

    expect(player.snapshot.paused).toBeTrue();
    expect(player.snapshot.volume).toBe(42);
  });
});
