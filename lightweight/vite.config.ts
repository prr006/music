import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Build the shared MELO renderer from gui/src/renderer. The Tauri bridge is
// imported from gui/src/renderer/main.tsx and wires window.api to Tauri.
export default defineConfig({
  root: resolve(__dirname, '../gui/src/renderer'),
  base: './',
  publicDir: false,
  plugins: [react()],
  resolve: {
    // The renderer lives outside this project, so Vite does not walk up from it
    // to find lightweight/node_modules. Alias the renderer dependencies here.
    alias: {
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
      'react-dom/client': resolve(__dirname, 'node_modules/react-dom/client.js'),
      'react/jsx-runtime': resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
      'lucide-react': resolve(__dirname, 'node_modules/lucide-react'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        index: resolve(__dirname, '../gui/src/renderer/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
  },
});
