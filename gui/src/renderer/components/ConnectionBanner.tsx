import type { ConnectionState } from '../hooks/useBackend';

export function ConnectionBanner({ state }: { state: ConnectionState }) {
  if (state === 'connected') return null;

  const label: Record<ConnectionState, string> = {
    starting:     'Starting backend…',
    connecting:   'Connecting to backend…',
    connected:    '',
    disconnected: 'Lost connection — reconnecting…',
    error:        'Backend unavailable',
  };

  return (
    <div
      className={`conn-banner-bar ${state}`}
      role="status"
      aria-live="polite"
      aria-label={label[state]}
    >
      {(state === 'starting' || state === 'connecting' || state === 'disconnected') && (
        <div className="spin-sm" aria-hidden="true" />
      )}
      <span>{label[state]}</span>
    </div>
  );
}
