import { useState, useEffect, useCallback } from 'react';
import { Search, List, Library, Moon, Sun, Monitor, Minus, Square, X } from 'lucide-react';
import type { ConnectionState } from '../hooks/useBackend';

type Theme = 'light' | 'dark' | 'system';

interface ChromeBarProps {
  theme: Theme;
  connectionState: ConnectionState;
  queueOpen: boolean;
  libraryOpen: boolean;
  onSearch: () => void;
  onToggleQueue: () => void;
  onToggleLibrary: () => void;
  onCycleTheme: () => void;
  onRetry?: () => void;
}

function AppIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'light') return <Sun size={14} />;
  if (theme === 'dark') return <Moon size={14} />;
  return <Monitor size={14} />;
}

// Maximized/restore icon
function MaximizeIcon({ maximized }: { maximized: boolean }) {
  if (maximized) {
    // Restore icon — two overlapping squares
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="0" y="2" width="7" height="7" rx="0.5" />
        <polyline points="2,2 2,0 10,0 10,8 8,8" />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" />
    </svg>
  );
}

const connLabel: Record<ConnectionState, string> = {
  starting: 'Starting',
  connecting: 'Connecting',
  connected: 'Connected',
  disconnected: 'Reconnecting',
  error: 'Error',
};

export function ChromeBar({
  theme,
  connectionState,
  queueOpen,
  libraryOpen,
  onSearch,
  onToggleQueue,
  onToggleLibrary,
  onCycleTheme,
  onRetry,
}: ChromeBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const isConnected = connectionState === 'connected';
  const isError = connectionState === 'error';

  // Initialize maximize state
  useEffect(() => {
    window.api.windowIsMaximized?.().then(setIsMaximized).catch(() => {});
  }, []);

  // Listen for maximize/restore changes
  useEffect(() => {
    const unsub = window.api.onWindowMaximized?.((m) => setIsMaximized(m));
    return () => unsub?.();
  }, []);

  const handleMinimize = useCallback(() => window.api.windowMinimize?.(), []);
  const handleMaximize = useCallback(() => window.api.windowMaximize?.(), []);
  const handleClose    = useCallback(() => window.api.windowClose?.(), []);

  return (
    <div className="chrome" role="banner" onDoubleClick={handleMaximize}>
      {/* Left: App identity — not draggable */}
      <div className="chrome-brand">
        <div className="chrome-logo" aria-hidden="true">
          <AppIcon />
        </div>
        <span className="chrome-app-name">YTMusic</span>
      </div>

      {/* Center drag region fills and contains the search trigger */}
      <div className="chrome-center">
        <button
          id="chrome-search-btn"
          className="chrome-search-btn"
          onClick={onSearch}
          title="Search for music (Ctrl+F)"
          aria-label="Open search"
        >
          <Search size={12} />
          <span>Search for music…</span>
          <kbd>Ctrl+F</kbd>
        </button>
      </div>

      {/* Right: app actions + window controls */}
      <div className="chrome-right">
        {/* App action buttons */}
        <div className="chrome-actions">
          <button
            id="chrome-library-btn"
            className={`cb ${libraryOpen ? 'active' : ''}`}
            onClick={onToggleLibrary}
            title="Library"
            aria-label="Toggle library"
            aria-pressed={libraryOpen}
          >
            <Library size={15} />
          </button>

          <button
            id="chrome-queue-btn"
            className={`cb ${queueOpen ? 'active' : ''}`}
            onClick={onToggleQueue}
            title="Queue"
            aria-label="Toggle queue"
            aria-pressed={queueOpen}
          >
            <List size={15} />
          </button>

          <button
            id="chrome-theme-btn"
            className="cb"
            onClick={onCycleTheme}
            title={`Theme: ${theme}`}
            aria-label={`Theme: ${theme}. Click to cycle.`}
          >
            <ThemeIcon theme={theme} />
          </button>

          {/* Connection pill — only show when not connected */}
          {!isConnected && (
            <div
              className={`conn-pill ${isError ? 'error' : ''}`}
              aria-label={`Connection: ${connLabel[connectionState]}`}
              role="status"
            >
              <span className="dot" aria-hidden="true" />
              <span>{connLabel[connectionState]}</span>
              {isError && onRetry && (
                <button className="conn-retry-btn" onClick={onRetry} aria-label="Retry">
                  Retry
                </button>
              )}
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="chrome-sep" aria-hidden="true" />

        {/* Native window controls */}
        <div className="wc-group" role="group" aria-label="Window controls">
          <button
            className="wc-btn wc-minimize"
            onClick={handleMinimize}
            title="Minimize"
            aria-label="Minimize window"
            id="btn-minimize"
          >
            <Minus size={10} strokeWidth={2} />
          </button>
          <button
            className="wc-btn wc-maximize"
            onClick={handleMaximize}
            title={isMaximized ? 'Restore' : 'Maximize'}
            aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
            id="btn-maximize"
          >
            <MaximizeIcon maximized={isMaximized} />
          </button>
          <button
            className="wc-btn wc-close"
            onClick={handleClose}
            title="Close"
            aria-label="Close window"
            id="btn-close"
          >
            <X size={11} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  );
}
