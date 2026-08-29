import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { BackendManager, type ConnectionState } from './backend-manager';

const TAG = '[BACKEND-LIFECYCLE]';
function log(msg: string) { console.log(`${TAG} [main] ${msg}`); }

// ─── Single Instance Lock ─────────────────────────────────────────────────

log('Electron main process starting');
log(`Packaged: ${app.isPackaged}`);
log(`Resources path: ${process.resourcesPath || '(none)'}`);
log(`CWD: ${process.cwd()}`);
log(`Platform: ${process.platform}`);
log(`USERNAME: ${process.env.USERNAME || '(not set)'}`);

const gotTheLock = app.requestSingleInstanceLock();
log(`Single instance lock: ${gotTheLock}`);

if (!gotTheLock) {
  log('Another instance already running — quitting');
  app.quit();
} else {
  // ─── Backend & Window ─────────────────────────────────────────────────────

  const backend = new BackendManager();
  let mainWindow: BrowserWindow | null = null;

  // ─── Window ───────────────────────────────────────────────────────────────

  function createWindow(): void {
    log('Creating BrowserWindow');
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      title: 'YTMusic Player',
      backgroundColor: '#0f0f0f',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
      titleBarStyle: 'hiddenInset',
      frame: process.platform !== 'win32',
      ...(process.platform === 'win32' ? { titleBarOverlay: true } : {}),
    });

    if (process.env.ELECTRON_RENDERER_URL) {
      mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
    }

    mainWindow.on('closed', () => {
      log('BrowserWindow closed');
      mainWindow = null;
    });
  }

  // ─── Backend → Renderer event forwarding ──────────────────────────────────

  backend.on('event', (event) => {
    mainWindow?.webContents.send('backend:event', event);
  });

  backend.on('connected', () => {
    log('Forwarding connected state to renderer');
    mainWindow?.webContents.send('backend:connection-state', 'connected');
  });

  backend.on('disconnected', () => {
    log('Forwarding disconnected state to renderer');
    mainWindow?.webContents.send('backend:connection-state', 'disconnected');
  });

  backend.on('state', (state: ConnectionState) => {
    log(`Forwarding state=${state} to renderer`);
    mainWindow?.webContents.send('backend:connection-state', state);
  });

  backend.on('error', (err: Error) => {
    log(`Forwarding error to renderer: ${err.message}`);
    mainWindow?.webContents.send('backend:connection-state', 'error');
  });

  backend.on('restart-failed', () => {
    log('Forwarding restart-failed to renderer');
    mainWindow?.webContents.send('backend:connection-state', 'error');
  });

  // ─── IPC Handlers ────────────────────────────────────────────────────────

  ipcMain.handle('backend:send', async (_event, command: Record<string, unknown>) => {
    const cmdType = (command as any).type;
    log(`IPC backend:send: type=${cmdType}`);
    try {
      const result = await backend.sendCommand(command);
      log(`IPC backend:send: type=${cmdType} → ok=${result.ok}`);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log(`IPC backend:send: type=${cmdType} → ERROR: ${msg}`);
      return { ok: false, message: msg };
    }
  });

  ipcMain.handle('backend:isConnected', () => {
    const connected = backend.state === 'connected';
    log(`IPC backend:isConnected → ${connected}`);
    return connected;
  });

  ipcMain.handle('backend:getConnectionState', () => {
    const state = backend.state;
    log(`IPC backend:getConnectionState → ${state}`);
    return state;
  });

  ipcMain.handle('backend:retry', async () => {
    const state = backend.state;
    log(`IPC backend:retry requested (current state=${state})`);
    if (state === 'error') {
      log('Restarting backend...');
      await backend.start();
    } else {
      log('Backend not in error state, skipping retry');
    }
  });

  // ─── App Lifecycle ────────────────────────────────────────────────────────

  app.whenReady().then(async () => {
    log('app.whenReady fired');

    // Start the backend (async — probes existing pipe first)
    log('Starting backend...');
    backend.start().catch(err => log(`Backend start error: ${err}`));

    // Create the window
    createWindow();
    log('Window created');

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // Second instance attempted — focus existing window
  app.on('second-instance', () => {
    log('Second instance detected — focusing existing window');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // ─── Shutdown ─────────────────────────────────────────────────────────────

  app.on('window-all-closed', async () => {
    log('All windows closed');
    if (process.platform !== 'darwin') {
      log('Quitting app...');
      await backend.shutdown();
      app.quit();
    }
  });

  // ─── Emergency cleanup ────────────────────────────────────────────────────

  process.on('SIGINT', async () => {
    log('SIGINT received');
    await backend.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    log('SIGTERM received');
    await backend.shutdown();
    process.exit(0);
  });
}
