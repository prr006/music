import type { ConnectionState, PlayerState } from '../hooks/useBackend';
import type { Theme } from '../types';
import type { AppSettings } from '../../shared/types';
import { SHORTCUTS } from '../lib/hotkeys';

interface SettingsPopoverProps {
  theme: Theme;
  connectionState: ConnectionState;
  settings: AppSettings;
  onTheme: (t: Theme) => void;
  onSettings: (patch: Partial<AppSettings>) => void;
  onRetry?: () => void;
  onToggleMini?: () => void;
}

export function SettingsPopover({
  theme, connectionState, settings, onTheme, onSettings, onRetry, onToggleMini,
}: SettingsPopoverProps) {
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

      <div className="section-kicker" style={{ marginTop: 14 }}>Playback</div>
      <label className="settings-row">
        <span>Autoplay next</span>
        <input
          type="checkbox"
          checked={settings.autoplay}
          onChange={e => onSettings({ autoplay: e.target.checked })}
        />
      </label>

      <div className="section-kicker" style={{ marginTop: 14 }}>Window</div>
      <label className="settings-row">
        <span>Close to tray</span>
        <input
          type="checkbox"
          checked={settings.closeBehavior === 'tray'}
          onChange={e => onSettings({ closeBehavior: e.target.checked ? 'tray' : 'quit' })}
        />
      </label>
      <label className="settings-row">
        <span>Minimize to tray</span>
        <input
          type="checkbox"
          checked={settings.minimizeToTray}
          onChange={e => onSettings({ minimizeToTray: e.target.checked })}
        />
      </label>
      <label className="settings-row">
        <span>Start minimized</span>
        <input
          type="checkbox"
          checked={settings.startMinimized}
          onChange={e => onSettings({ startMinimized: e.target.checked })}
        />
      </label>
      <label className="settings-row">
        <span>Mini always on top</span>
        <input
          type="checkbox"
          checked={settings.miniAlwaysOnTop}
          onChange={e => onSettings({ miniAlwaysOnTop: e.target.checked })}
        />
      </label>
      {onToggleMini && (
        <button className="text-link" onClick={onToggleMini}>Open mini player</button>
      )}

      <div className="section-kicker" style={{ marginTop: 14 }}>Shortcuts</div>
      <ul className="shortcut-list">
        {SHORTCUTS.map(item => (
          <li key={item.id}>
            <span>{item.label}</span>
            <kbd>{item.keys}</kbd>
          </li>
        ))}
      </ul>

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

export type { PlayerState };
