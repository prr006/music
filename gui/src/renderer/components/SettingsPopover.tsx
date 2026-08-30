import type { ConnectionState } from '../hooks/useBackend';
import type { Theme } from '../types';

interface SettingsPopoverProps {
  theme: Theme;
  connectionState: ConnectionState;
  onTheme: (t: Theme) => void;
  onRetry?: () => void;
}

export function SettingsPopover({ theme, connectionState, onTheme, onRetry }: SettingsPopoverProps) {
  return (
    <div className="settings-pop" role="dialog" aria-label="Settings">
      <div className="section-kicker">Appearance</div>
      <div className="chip-row">
        {(['light', 'dark', 'system'] as Theme[]).map(t => (
          <button
            key={t}
            className={`chip${theme === t ? ' selected' : ''}`}
            onClick={() => onTheme(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="section-kicker" style={{ marginTop: 14 }}>Engine</div>
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 10px' }}>
        {connectionState === 'connected' ? 'Connected to the local player.' : `Status: ${connectionState}`}
      </p>
      {connectionState === 'error' && onRetry && (
        <button className="text-link" onClick={onRetry}>Retry connection</button>
      )}
    </div>
  );
}
