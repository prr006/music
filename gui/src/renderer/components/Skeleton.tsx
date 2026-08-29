/** Skeleton loading placeholders */

export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton" style={{ width: '100%', aspectRatio: '1', borderRadius: 'var(--r-sm)' }} />
      <div className="skeleton" style={{ width: '75%', height: 12, marginTop: 10 }} />
      <div className="skeleton" style={{ width: '50%', height: 10, marginTop: 6 }} />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="skeleton-row">
      <div className="skeleton" style={{ width: 24, height: 12, borderRadius: 3 }} />
      <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 'var(--r-xs)' }} />
      <div style={{ flex: 1 }}>
        <div className="skeleton" style={{ width: '60%', height: 12, marginBottom: 6 }} />
        <div className="skeleton" style={{ width: '40%', height: 10 }} />
      </div>
      <div className="skeleton" style={{ width: 32, height: 12, borderRadius: 3 }} />
    </div>
  );
}

export function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--sp-4)', overflow: 'hidden' }}>
      {Array.from({ length: count }, (_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="track-list">
      {Array.from({ length: count }, (_, i) => <SkeletonRow key={i} />)}
    </div>
  );
}
