import { useState, useEffect, useCallback } from 'react';
import { Minus, Square, X } from 'lucide-react';

function MaximizeIcon({ maximized }: { maximized: boolean }) {
  if (maximized) {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
        <rect x="0" y="2" width="7" height="7" rx="0.5" />
        <polyline points="2,2 2,0 10,0 10,8 8,8" />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" />
    </svg>
  );
}

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    window.api.windowIsMaximized?.().then(setIsMaximized).catch(() => {});
  }, []);

  useEffect(() => {
    const unsub = window.api.onWindowMaximized?.((m) => setIsMaximized(m));
    return () => unsub?.();
  }, []);

  const handleMinimize = useCallback(() => window.api.windowMinimize?.(), []);
  const handleMaximize = useCallback(() => window.api.windowMaximize?.(), []);
  const handleClose = useCallback(() => window.api.windowClose?.(), []);

  return (
    <div className="titlebar" onDoubleClick={handleMaximize} data-tauri-drag-region>
      <div className="titlebar-left" aria-hidden="true" data-tauri-drag-region />
      <div className="titlebar-wordmark" data-tauri-drag-region>MELO</div>
      <div className="titlebar-right" role="group" aria-label="Window controls">
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
  );
}
