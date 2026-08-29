import { contextBridge, ipcRenderer } from 'electron';
import type { ControlCommand, ControlResponse } from '../shared/types';

contextBridge.exposeInMainWorld('api', {
  // Send a command to the backend (includes search)
  sendCommand: (command: ControlCommand): Promise<ControlResponse> => {
    return ipcRenderer.invoke('backend:send', command);
  },

  // Check connection status
  isConnected: (): Promise<boolean> => {
    return ipcRenderer.invoke('backend:isConnected');
  },

  // Get detailed connection state
  getConnectionState: (): Promise<string> => {
    return ipcRenderer.invoke('backend:getConnectionState');
  },

  // Request backend retry (when in error state)
  retryBackend: (): Promise<void> => {
    return ipcRenderer.invoke('backend:retry');
  },

  // Listen for backend events (returns cleanup function)
  onEvent: (callback: (event: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('backend:event', handler);
    return () => ipcRenderer.removeListener('backend:event', handler);
  },

  // Listen for connection state changes (returns cleanup function)
  onConnectionState: (callback: (state: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: string) => callback(state);
    ipcRenderer.on('backend:connection-state', handler);
    return () => ipcRenderer.removeListener('backend:connection-state', handler);
  },

  // Legacy: Listen for connection status changes (returns cleanup function)
  onConnected: (callback: (connected: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, connected: boolean) => callback(connected);
    ipcRenderer.on('backend:connected', handler);
    return () => ipcRenderer.removeListener('backend:connected', handler);
  },
});
