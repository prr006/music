import { Loader, WifiOff, RefreshCw } from 'lucide-react';
import type { ConnectionState } from '../hooks/useBackend';

export function ConnectionBanner({ state, onRetry }: { state: ConnectionState; onRetry?: () => void }) {
  if (state === 'connected') return null;
  return (
    <div className={`conn ${state === 'error' ? 'err' : ''}`}>
      {(state === 'starting' || state === 'connecting') && <Loader size={11} style={{ animation: 'spin 1s linear infinite' }} />}
      {state === 'disconnected' && <WifiOff size={11} />}
      {state === 'error' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />}
      <span>
        {state === 'starting' && 'Starting...'}
        {state === 'connecting' && 'Connecting...'}
        {state === 'disconnected' && 'Reconnecting...'}
        {state === 'error' && 'Service unavailable'}
      </span>
      {state === 'error' && onRetry && (
        <button className="conn-retry" onClick={onRetry}><RefreshCw size={10} /> Retry</button>
      )}
    </div>
  );
}
