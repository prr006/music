import React from 'react';
import { createRoot } from 'react-dom/client';
import { installTauriBridge } from './tauri-bridge';
import { App } from './App';

// In Tauri (lightweight build) this installs window.api from window.__TAURI__.
// In Electron it is a no-op; the preload script still provides window.api.
installTauriBridge();

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
