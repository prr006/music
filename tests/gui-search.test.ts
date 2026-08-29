/**
 * Integration test: verify the search, play-track, and playback-state
 * commands work through the control protocol.
 * This is the exact flow the Electron GUI uses.
 */

import { describe, expect, test, afterAll } from 'bun:test';
import { PlaybackEngine } from '../src/engine';
import { ControlServer, sendControlCommand } from '../src/control';
import type { Track } from '../src/types';
import type { ControlCommand } from '../src/cli';

const TIMEOUT = 30_000;

describe('Search via control protocol', () => {
  let engine: PlaybackEngine;
  let controlServer: ControlServer;

  afterAll(async () => {
    try { await engine?.stop(); } catch {}
    try { await engine?.quit(); } catch {}
    try { await controlServer?.stop(); } catch {}
  });

  test('starts engine and control server', async () => {
    engine = new PlaybackEngine();
    await engine.start();

    controlServer = new ControlServer(async (command) => {
      switch (command.type) {
        case 'search': {
          const tracks = await engine.searchTracks(command.query, command.limit);
          return {
            ok: true,
            message: tracks.map((t: Track, i: number) => `${i + 1}. ${t.title}`).join('\n'),
            data: tracks,
          };
        }
        case 'play': {
          const [first] = await engine.searchTracks(command.query, 1);
          if (!first) throw new Error('No results');
          await engine.play(first);
          return { ok: true, message: `Playing: ${first.title}` };
        }
        case 'play-track': {
          await engine.play(command.track);
          return { ok: true, message: `Playing: ${command.track.title}` };
        }
        case 'toggle': {
          await engine.togglePause();
          return { ok: true, message: engine.state.paused ? 'Paused.' : 'Resumed.' };
        }
        case 'get-queue':
          return {
            ok: true,
            message: engine.queue.map((qi, i) => `${i + 1}. [${qi.source}] ${qi.track.title}`).join('\n'),
            data: engine.queue,
          };
        case 'get-state':
          return {
            ok: true,
            message: 'ok',
            data: {
              currentTrack: engine.currentTrack,
              queue: engine.queue,
              volume: engine.volume,
              paused: engine.state.paused,
            },
          };
        default:
          return { ok: false, message: 'Unsupported control command.' };
      }
    }, controlServer?.path);
    await controlServer.start();
  }, TIMEOUT);

  test('search returns real results via control socket', async () => {
    const response = await sendControlCommand(
      { type: 'search', query: 'Never Gonna Give You Up', limit: 3 } as ControlCommand,
      { timeout: 15_000 }
    );

    expect(response.ok).toBe(true);
    expect(response.message).toContain('Rick Astley');

    // Check if data was returned
    if ('data' in response) {
      const data = (response as any).data as Track[];
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].id).toBeTruthy();
      expect(data[0].title).toBeTruthy();
      expect(data[0].url).toContain('youtube.com');
      console.log(`  Found: "${data[0].title}" (${data[0].id})`);
    }
  }, TIMEOUT);

  test('play command starts playback and generates radio', async () => {
    const refilledPromise = new Promise<void>((resolve) => {
      engine.once('queue-refilled', () => resolve());
    });

    const response = await sendControlCommand(
      { type: 'play', query: 'Never Gonna Give You Up Rick Astley' } as ControlCommand,
      { timeout: 15_000 }
    );

    expect(response.ok).toBe(true);
    expect(engine.currentTrack).toBeTruthy();
    console.log(`  Playing: "${engine.currentTrack?.title}"`);

    await refilledPromise;
    expect(engine.queue.length).toBeGreaterThan(0);
    console.log(`  Radio loaded: ${engine.queue.length} tracks`);
  }, TIMEOUT);

  test('get-queue returns tracks with source tags', async () => {
    const response = await sendControlCommand(
      { type: 'get-queue' } as ControlCommand,
      { timeout: 5_000 }
    );

    expect(response.ok).toBe(true);
    expect(response.message).toContain('[radio]');
    console.log(`  Queue: ${response.message.split('\n').length} items`);
  }, TIMEOUT);

  test('get-state returns full state', async () => {
    const response = await sendControlCommand(
      { type: 'get-state' } as ControlCommand,
      { timeout: 5_000 }
    );

    expect(response.ok).toBe(true);
    console.log(`  State: track="${engine.currentTrack?.title}", queue=${engine.queue.length}`);
  }, TIMEOUT);

  test('play-track command plays exact track by object', async () => {
    // Search for a different track
    const searchResponse = await sendControlCommand(
      { type: 'search', query: 'Bohemian Rhapsody Queen', limit: 3 } as ControlCommand,
      { timeout: 15_000 }
    );
    expect(searchResponse.ok).toBe(true);
    const tracks = (searchResponse as any).data as Track[];
    expect(tracks.length).toBeGreaterThan(0);

    const targetTrack = tracks[0]!;
    console.log(`  Target: "${targetTrack.title}" (${targetTrack.id})`);

    // Play it via play-track (the exact same command the GUI sends)
    const prevTrack = engine.currentTrack;
    const playResponse = await sendControlCommand(
      { type: 'play-track', track: targetTrack } as ControlCommand,
      { timeout: 15_000 }
    );

    expect(playResponse.ok).toBe(true);
    expect(playResponse.message).toContain(targetTrack.title);
    expect(engine.currentTrack?.id).toBe(targetTrack.id);
    console.log(`  Switched to: "${engine.currentTrack?.title}"`);
  }, TIMEOUT);

  test('play-track switches away from currently playing track', async () => {
    // Get current track
    const beforeResponse = await sendControlCommand(
      { type: 'get-state' } as ControlCommand,
      { timeout: 5_000 }
    );
    const beforeTrack = (beforeResponse as any).data?.currentTrack as Track | undefined;
    expect(beforeTrack).toBeTruthy();
    console.log(`  Before: "${beforeTrack!.title}"`);

    // Search for something completely different
    const searchResponse = await sendControlCommand(
      { type: 'search', query: 'Stairway to Heaven Led Zeppelin', limit: 1 } as ControlCommand,
      { timeout: 15_000 }
    );
    const tracks = (searchResponse as any).data as Track[];
    expect(tracks.length).toBeGreaterThan(0);

    // Switch to the new track
    await sendControlCommand(
      { type: 'play-track', track: tracks[0]! } as ControlCommand,
      { timeout: 15_000 }
    );

    // Verify the track changed
    expect(engine.currentTrack?.id).toBe(tracks[0]!.id);
    expect(engine.currentTrack?.id).not.toBe(beforeTrack!.id);

    const afterResponse = await sendControlCommand(
      { type: 'get-state' } as ControlCommand,
      { timeout: 5_000 }
    );
    const afterTrack = (afterResponse as any).data?.currentTrack as Track;
    expect(afterTrack.id).toBe(tracks[0]!.id);
    console.log(`  After: "${afterTrack.title}"`);
  }, TIMEOUT);
});

// ─── Playback-state propagation test ──────────────────────────────────────
// Verifies that after switching tracks, playback-state events continue
// updating with the new track's info, just as they do in the GUI.

describe('Playback-state events after track switch', () => {
  let engine: PlaybackEngine;
  let controlServer: ControlServer;

  afterAll(async () => {
    try { await engine?.stop(); } catch {}
    try { await engine?.quit(); } catch {}
    try { await controlServer?.stop(); } catch {}
  });

  test('sets up engine and control server with event forwarding', async () => {
    engine = new PlaybackEngine();
    await engine.start();

    controlServer = new ControlServer(async (command) => {
      switch (command.type) {
        case 'search': {
          const tracks = await engine.searchTracks(command.query, command.limit);
          return {
            ok: true,
            message: tracks.map((t: Track, i: number) => `${i + 1}. ${t.title}`).join('\n'),
            data: tracks,
          };
        }
        case 'play-track': {
          await engine.play(command.track);
          return { ok: true, message: `Playing: ${command.track.title}` };
        }
        case 'get-state':
          return {
            ok: true,
            message: 'ok',
            data: {
              currentTrack: engine.currentTrack,
              queue: engine.queue,
              volume: engine.volume,
              paused: engine.state.paused,
            },
          };
        default:
          return { ok: false, message: 'Unsupported control command.' };
      }
    });
    // Forward engine events to subscribers (mirrors src/index.ts)
    const forwardEvent = (event: any) => {
      if (event && typeof event === 'object' && 'type' in event) {
        controlServer?.broadcast(event);
      }
    };
    engine.on('track-changed', forwardEvent);
    engine.on('playback-state', forwardEvent);
    await controlServer.start();
  }, TIMEOUT);

  test('playback-state events reach subscribers after switching tracks', async () => {
    // Search for two different tracks
    const search1 = await sendControlCommand(
      { type: 'search', query: 'Hotel California Eagles', limit: 1 } as ControlCommand,
      { timeout: 15_000 }
    );
    const track1 = ((search1 as any).data as Track[])[0]!;
    expect(track1).toBeTruthy();

    const search2 = await sendControlCommand(
      { type: 'search', query: 'Bohemian Rhapsody Queen', limit: 1 } as ControlCommand,
      { timeout: 15_000 }
    );
    const track2 = ((search2 as any).data as Track[])[0]!;
    expect(track2).toBeTruthy();

    // Play first track
    await sendControlCommand(
      { type: 'play-track', track: track1 } as ControlCommand,
      { timeout: 15_000 }
    );
    expect(engine.currentTrack?.id).toBe(track1.id);

    // Collect playback-state events via a subscriber socket
    const { createConnection } = require('net');
    const events: any[] = [];
    const subscriber = createConnection(controlServer.path);

    await new Promise<void>((resolve) => {
      subscriber.on('connect', () => {
        subscriber.write(JSON.stringify({ type: 'subscribe' }) + '\n');
        resolve();
      });
    });

    // Read the subscribe response
    await new Promise<void>((resolve) => {
      subscriber.once('data', () => resolve());
    });

    // Listen for events
    subscriber.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg?.type === 'playback-state') events.push(msg);
        } catch {}
      }
    });

    // Wait for at least one playback-state event from track1
    await new Promise((r) => setTimeout(r, 600));
    expect(events.some((e: any) => e.track?.id === track1.id)).toBe(true);
    console.log(`  Got playback-state for track1: "${track1.title}"`);

    // Now switch to track2
    events.length = 0;
    await sendControlCommand(
      { type: 'play-track', track: track2 } as ControlCommand,
      { timeout: 15_000 }
    );
    expect(engine.currentTrack?.id).toBe(track2.id);

    // Wait for playback-state events from track2
    await new Promise((r) => setTimeout(r, 600));

    // The new playback-state events should reference track2
    expect(events.some((e: any) => e.track?.id === track2.id)).toBe(true);
    console.log(`  Got playback-state for track2: "${track2.title}"`);

    // Verify playing state and position are present
    const latestEvent = events.find((e: any) => e.track?.id === track2.id);
    expect(latestEvent).toBeTruthy();
    expect(typeof latestEvent.playing).toBe('boolean');
    expect(typeof latestEvent.position).toBe('number');
    expect(typeof latestEvent.duration).toBe('number');
    expect(typeof latestEvent.volume).toBe('number');
    console.log(`  playing=${latestEvent.playing}, pos=${latestEvent.position}s, dur=${latestEvent.duration}s`);

    subscriber.destroy();
  }, TIMEOUT);
});
