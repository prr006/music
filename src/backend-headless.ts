/**
 * Headless MELO backend for the Electron GUI.
 *
 * Starts MeloApp and the control socket without a terminal UI.
 */

import { MeloApp } from './melo/app';
import { ControlServer } from './melo/ipc/control-server';
import { createControlHandler } from './melo/ipc/handler';
import { setLang, type Lang } from './i18n';
import { ensureRuntimeDependencies } from './dependencies';
import { log, logError } from './melo/log';
import type { MeloEvent } from './melo/types';

let controlServer: ControlServer | null = null;
let app: MeloApp;
let playerStarted = false;
let isCleaningUp = false;

async function cleanup() {
  if (isCleaningUp) return;
  isCleaningUp = true;
  log('app', 'Shutting down...');
  try { await controlServer?.stop(); } catch {}
  controlServer = null;
  if (playerStarted) await app.quit();
  log('app', 'Backend stopped.');
}

async function main() {
  log('app', 'Starting MELO backend...');
  await ensureRuntimeDependencies();

  app = new MeloApp();
  const settings = app.loadSettings();
  setLang((settings.lang as Lang) || 'en');

  await app.start();
  playerStarted = true;

  const handle = createControlHandler(app, () => {
    void cleanup().finally(() => process.exit(0));
  });

  controlServer = new ControlServer(handle);
  await controlServer.start();

  const forward = (event: MeloEvent) => controlServer?.broadcast(event);
  app.on('track-changed', forward);
  app.on('playback-state', forward);
  app.on('queue-changed', forward);
  app.on('queue-refilled', forward);
  app.on('volume-changed', forward);
  app.on('shuffle-changed', forward);
  app.on('repeat-changed', forward);
  app.on('favorites-changed', forward);

  const handleExit = async () => {
    await cleanup();
    process.exit(0);
  };

  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);
  process.on('SIGHUP', handleExit);
  process.on('SIGUSR2', handleExit);

  process.on('uncaughtException', async (err) => {
    logError('app', `Uncaught exception: ${err.message}`);
    await cleanup();
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    logError('app', `Unhandled rejection: ${reason}`);
    await cleanup();
    process.exit(1);
  });

  log('app', 'READY');
}

main().catch(async (e) => {
  const message = e instanceof Error ? e.message : String(e);
  logError('app', `Startup failed: ${message}`);
  if (playerStarted || controlServer) await cleanup();
  process.exit(1);
});
