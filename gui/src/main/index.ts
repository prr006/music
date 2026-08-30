import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Tray } from 'electron';
import { existsSync } from 'fs';
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
  let miniWindow: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let closeBehavior: 'quit' | 'tray' = 'quit';
  let minimizeToTray = false;
  let miniAlwaysOnTop = true;
  let isQuitting = false;

  // ─── Window ───────────────────────────────────────────────────────────────

  function createWindow(): void {
    log('Creating BrowserWindow');
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 860,
      minWidth: 960,
      minHeight: 620,
      title: 'MELO',
      backgroundColor: '#0b0b10',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
      // Fully frameless — our custom chrome handles all window decoration
      frame: false,
      titleBarStyle: 'hidden',
    });

    if (process.env.ELECTRON_RENDERER_URL) {
      mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
    }

    mainWindow.on('minimize', () => {
      if (minimizeToTray) hideToTray();
    });

    mainWindow.on('close', (event) => {
      if (closeBehavior === 'tray' && !isQuitting) {
        event.preventDefault();
        hideToTray();
        return;
      }
      if (miniWindow && !miniWindow.isDestroyed()) miniWindow.close();
    });

    mainWindow.on('closed', () => {
      log('BrowserWindow closed');
      mainWindow = null;
    });

    // Forward maximize/unmaximize to renderer so the button can update
    mainWindow.on('maximize',   () => mainWindow?.webContents.send('window:maximized', true));
    mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false));
    mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send('window:maximized', true));
    mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send('window:maximized', false));
  }

  // ─── Backend → Renderer event forwarding ──────────────────────────────────

  function broadcast(channel: string, payload: unknown) {
    mainWindow?.webContents.send(channel, payload);
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.webContents.send(channel, payload);
  }

  backend.on('event', (event) => {
    broadcast('backend:event', event);
  });

  backend.on('connected', () => {
    log('Forwarding connected state to renderer');
    broadcast('backend:connection-state', 'connected');
  });

  backend.on('disconnected', () => {
    log('Forwarding disconnected state to renderer');
    broadcast('backend:connection-state', 'disconnected');
  });

  backend.on('state', (state: ConnectionState) => {
    log(`Forwarding state=${state} to renderer`);
    broadcast('backend:connection-state', state);
  });

  backend.on('error', (err: Error) => {
    log(`Forwarding error to renderer: ${err.message}`);
    broadcast('backend:connection-state', 'error');
  });

  backend.on('restart-failed', () => {
    log('Forwarding restart-failed to renderer');
    broadcast('backend:connection-state', 'error');
  });

  // ─── Window Control IPC ──────────────────────────────────────────────────

  function hideToTray() {
    mainWindow?.hide();
    ensureTray();
  }

  ipcMain.on('window:minimize', () => {
    log('IPC window:minimize');
    if (minimizeToTray) hideToTray();
    else mainWindow?.minimize();
  });

  ipcMain.on('window:maximize', () => {
    log('IPC window:maximize');
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    log('IPC window:close');
    mainWindow?.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });

  ipcMain.handle('window:toggle-mini', () => {
    if (miniWindow && !miniWindow.isDestroyed()) {
      if (miniWindow.isVisible()) {
        miniWindow.hide();
        return false;
      }
      miniWindow.show();
      return true;
    }
    createMiniWindow();
    return true;
  });

  ipcMain.handle('window:mini-always-on-top', (_event, value: boolean) => {
    miniAlwaysOnTop = !!value;
    miniWindow?.setAlwaysOnTop(miniAlwaysOnTop);
  });

  ipcMain.handle('window:set-close-behavior', (_event, value: 'quit' | 'tray') => {
    closeBehavior = value === 'tray' ? 'tray' : 'quit';
    if (closeBehavior === 'tray') ensureTray();
  });

  ipcMain.handle('window:set-minimize-to-tray', (_event, value: boolean) => {
    minimizeToTray = !!value;
    if (minimizeToTray) ensureTray();
  });

  ipcMain.on('window:show-main', () => {
    if (!mainWindow) createWindow();
    mainWindow?.show();
    mainWindow?.focus();
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
    registerMediaKeys();

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
    if (closeBehavior === 'tray' && !isQuitting) return;
    if (process.platform !== 'darwin' || isQuitting) {
      log('Quitting app...');
      isQuitting = true;
      await backend.shutdown();
      app.quit();
    }
  });

  function createMiniWindow(): void {
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.show();
      return;
    }
    miniWindow = new BrowserWindow({
      width: 420,
      height: 88,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: miniAlwaysOnTop,
      backgroundColor: '#0b0b10',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    if (process.env.ELECTRON_RENDERER_URL) {
      miniWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#mini`);
    } else {
      miniWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'mini' });
    }
    miniWindow.on('closed', () => { miniWindow = null; });
  }

  function trayImage() {
    const candidates = [
      join(__dirname, '../../resources/tray.png'),
      join(__dirname, '../../resources/icon.png'),
      join(process.resourcesPath || '', 'tray.png'),
      join(process.resourcesPath || '', 'icon.png'),
      join(__dirname, '../../resources/icon.ico'),
      join(process.resourcesPath || '', 'icon.ico'),
    ];
    for (const path of candidates) {
      if (existsSync(path)) {
        const image = nativeImage.createFromPath(path);
        if (!image.isEmpty()) return image.resize({ width: 32, height: 32 });
      }
    }
    return nativeImage.createEmpty();
  }

  function ensureTray() {
    if (tray) return;
    try {
      tray = new Tray(trayImage());
      tray.setToolTip('MELO');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Show MELO', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
        { label: 'Mini player', click: () => createMiniWindow() },
        { type: 'separator' },
        { label: 'Play / Pause', click: () => { void backend.sendCommand({ type: 'toggle' }); } },
        { label: 'Next', click: () => { void backend.sendCommand({ type: 'next' }); } },
        { type: 'separator' },
        { label: 'Quit', click: () => { void quitApp(); } },
      ]));
      tray.on('click', () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) mainWindow.hide();
        else { mainWindow.show(); mainWindow.focus(); }
      });
    } catch (error) {
      log(`Tray unavailable: ${error instanceof Error ? error.message : String(error)}`);
      tray = null;
    }
  }

  function registerMediaKeys() {
    const bindings: Array<[string, Record<string, unknown>]> = [
      ['MediaPlayPause', { type: 'toggle' }],
      ['MediaNextTrack', { type: 'next' }],
      ['MediaPreviousTrack', { type: 'previous' }],
    ];
    for (const [accel, command] of bindings) {
      try {
        const ok = globalShortcut.register(accel, () => { void backend.sendCommand(command); });
        if (!ok) log(`Shortcut ${accel} already in use`);
      } catch (error) {
        log(`Shortcut ${accel} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async function quitApp() {
    if (isQuitting) return;
    isQuitting = true;
    globalShortcut.unregisterAll();
    try { await backend.shutdown(); } catch {}
    app.quit();
  }

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  // ─── Emergency cleanup ────────────────────────────────────────────────────

  process.on('SIGINT', async () => {
    log('SIGINT received');
    await quitApp();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    log('SIGTERM received');
    await quitApp();
    process.exit(0);
  });
}
