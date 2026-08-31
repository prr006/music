/**
 * Tauri 2 bridge for the shared MELO renderer.
 *
 * The renderer was written against the Electron preload API (`window.api`).
 * When running under Tauri with `withGlobalTauri: true`, Tauri injects the
 * global `window.__TAURI__` object. This module installs the same `window.api`
 * surface on top of that global, so the React UI does not need to change.
 *
 * In Electron this module is a no-op because `window.__TAURI__` is undefined.
 */

type Unlisten = () => void;

function tauri() {
  return (window as unknown as { __TAURI__?: any }).__TAURI__;
}

function wireListen(rawEvent: string, callback: (payload: unknown) => void): Unlisten {
  const t = tauri();
  const listen = t?.event?.listen;
  if (!listen) return () => {};

  let cancelled = false;
  let stop: Unlisten | null = null;

  void listen(rawEvent, (ev: { payload: unknown }) => {
    if (!cancelled) callback(ev?.payload);
  }).then((unlisten: Unlisten) => {
    if (cancelled) unlisten();
    else stop = unlisten;
  }).catch(() => {});

  return () => {
    cancelled = true;
    if (stop) stop();
  };
}

function wireWindowResized(currentWindow: any, callback: (maximized: boolean) => void): Unlisten {
  const t = tauri();
  const listen = t?.event?.listen;
  const onResized = currentWindow?.onResized;

  if (typeof onResized === 'function') {
    let cancelled = false;
    let stop: Unlisten | null = null;
    void onResized.call(currentWindow, async () => {
      if (!cancelled) {
        try {
          callback(await currentWindow.isMaximized());
        } catch {}
      }
    }).then((unlisten: Unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (stop) stop();
    };
  }

  if (typeof listen === 'function') {
    return wireListen('tauri://resize', () => {
      if (currentWindow?.isMaximized) {
        void currentWindow.isMaximized().then((m: boolean) => callback(m)).catch(() => {});
      }
    });
  }

  return () => {};
}

export function installTauriBridge(): void {
  const t = tauri();
  if (!t) return;

  const invoke = t.core?.invoke;
  if (typeof invoke !== 'function') return;

  const currentWindow = (() => {
    try {
      return t.window?.getCurrentWindow?.();
    } catch {
      return null;
    }
  })();

  const api = {
    sendCommand: (command: unknown): Promise<{ ok: boolean; message: string; data?: unknown }> => {
      return invoke('backend_send', { command });
    },

    isConnected: (): Promise<boolean> => invoke('backend_is_connected'),

    getConnectionState: (): Promise<string> => invoke('backend_get_connection_state'),

    retryBackend: (): Promise<void> => invoke('backend_retry'),

    onEvent: (callback: (event: unknown) => void): Unlisten => wireListen('backend:event', callback),

    onConnectionState: (callback: (state: string) => void): Unlisten => {
      return wireListen('backend:connection-state', (payload) => callback(String(payload)));
    },

    onConnected: (callback: (connected: boolean) => void): Unlisten => {
      return wireListen('backend:connected', (payload) => callback(Boolean(payload)));
    },

    windowMinimize: (): void => {
      void currentWindow?.minimize?.().catch(() => {});
    },

    windowMaximize: (): void => {
      const win = currentWindow;
      if (!win) return;
      void win.isMaximized()
        .then((maximized: boolean) => (maximized ? win.unmaximize() : win.maximize()))
        .catch(() => {});
    },

    windowClose: (): void => {
      // Closing the window shuts down the Tauri app, which synchronously stops
      // the mpv child before the process exits.
      void currentWindow?.close?.().catch(() => {});
    },

    windowIsMaximized: (): Promise<boolean> => {
      return currentWindow?.isMaximized?.() ?? Promise.resolve(false);
    },

    onWindowMaximized: (callback: (maximized: boolean) => void): Unlisten => {
      return wireWindowResized(currentWindow, callback);
    },

    // The Electron renderer calls these optional Mini Player / tray-settings
    // methods. The lightweight Tauri shell does not implement a separate mini
    // window yet, so the methods are present but no-op / faithful best-effort.
    toggleMiniPlayer: (): Promise<boolean> => Promise.resolve(false),

    setMiniAlwaysOnTop: (_value: boolean): Promise<void> => Promise.resolve(),

    setCloseBehavior: (_value: 'quit' | 'tray'): Promise<void> => Promise.resolve(),

    setMinimizeToTray: (_value: boolean): Promise<void> => Promise.resolve(),

    showMainWindow: (): void => {
      void currentWindow?.show?.().catch(() => {});
      void currentWindow?.setFocus?.().catch(() => {});
    },
  };

  (window as unknown as { api: unknown }).api = api;
}
