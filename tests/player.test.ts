import { describe, expect, test } from 'bun:test';
import { Player } from '../src/player';

interface PlayerInternals {
  socket: { destroyed: boolean; write: (data: string) => void } | null;
  send: (...args: any[]) => Promise<any>;
  onData: (data: string) => void;
}

function withFakeSocket(player: Player) {
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
    const internals = new Player() as unknown as PlayerInternals;
    await expect(internals.send('get_property', 'volume')).rejects.toThrow('not available');
  });

  test('resolves a successful mpv response', async () => {
    const { internals, writes } = withFakeSocket(new Player());
    const response = internals.send('get_property', 'volume');
    const request = JSON.parse(writes[0]!);

    internals.onData(`${JSON.stringify({ request_id: request.request_id, error: 'success', data: 42 })}\n`);

    await expect(response).resolves.toMatchObject({ data: 42 });
  });

  test('rejects an mpv command error', async () => {
    const { internals, writes } = withFakeSocket(new Player());
    const response = internals.send('bad-command');
    const request = JSON.parse(writes[0]!);

    internals.onData(`${JSON.stringify({ request_id: request.request_id, error: 'invalid parameter' })}\n`);

    await expect(response).rejects.toThrow('invalid parameter');
  });

  test('tracks mute property updates', () => {
    const { internals } = withFakeSocket(new Player());
    internals.onData(`${JSON.stringify({ event: 'property-change', name: 'mute', data: true })}\n`);
    expect((internals as unknown as Player).state.muted).toBeTrue();
  });

  test('sets pause and volume state after successful commands', async () => {
    const player = new Player();
    const { internals, writes } = withFakeSocket(player);

    const pause = player.setPaused(true);
    const pauseRequest = JSON.parse(writes[0]!);
    internals.onData(`${JSON.stringify({ request_id: pauseRequest.request_id, error: 'success' })}\n`);
    await pause;

    const setVolume = player.setVolume(42);
    const volumeRequest = JSON.parse(writes[1]!);
    internals.onData(`${JSON.stringify({ request_id: volumeRequest.request_id, error: 'success' })}\n`);
    await setVolume;

    expect(player.state.paused).toBeTrue();
    expect(player.state.volume).toBe(42);
  });
});
