import React from 'react';
import { createRoot } from 'react-dom/client';
import { installTauriBridge } from './tauri-bridge';
import { App } from './App';

// Installs the `window.api` surface from Tauri's `window.__TAURI__` global so
// the renderer can talk to the Rust backend through the same API it expects.
installTauriBridge();

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
