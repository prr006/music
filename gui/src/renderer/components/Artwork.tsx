import { useState } from 'react';

function ytThumb(id: string, quality: 'default' | 'mq' | 'hq' | 'maxres' = 'mq') {
  if (quality === 'maxres') return `https://img.youtube.com/vi/${id}/maxresdefault.jpg`;
  if (quality === 'hq') return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
  if (quality === 'mq') return `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
  return `https://img.youtube.com/vi/${id}/default.jpg`;
}

export { ytThumb };

interface Props {
  id: string;
  size?: number;
  quality?: 'default' | 'mq' | 'hq' | 'maxres';
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  rounded?: boolean;
  /** Show loading overlay */
  loading?: boolean;
}

const PLACEHOLDER_BG = 'var(--bg-highlight)';

export function Artwork({ id, size, quality = 'mq', alt = '', className, style, rounded, loading }: Props) {
  const [error, setError] = useState(false);
  const src = error ? ytThumb(id, 'default') : ytThumb(id, quality);

  const baseStyle: React.CSSProperties = {
    width: size, height: size,
    objectFit: 'cover',
    background: PLACEHOLDER_BG,
    borderRadius: rounded ? 'var(--r-md)' : 'var(--r-xs)',
    flexShrink: 0,
    ...style,
  };

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <img
        src={src}
        alt={alt}
        className={className}
        style={baseStyle}
        loading="lazy"
        onError={() => !error && setError(true)}
      />
      {loading && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: baseStyle.borderRadius,
          backdropFilter: 'blur(4px)',
        }}>
          <div className="spinner spinner-sm" />
        </div>
      )}
    </div>
  );
}

/** Large artwork for Now Playing */
export function ArtworkLarge({ id, loading }: { id: string; loading?: boolean }) {
  return (
    <div style={{
      width: 320, height: 320,
      borderRadius: 'var(--r-lg)',
      overflow: 'hidden',
      background: 'var(--bg-elevated)',
      boxShadow: 'var(--shadow-3)',
      position: 'relative',
      animation: 'fadeIn 0.4s var(--ease)',
    }} key={id}>
      <img
        src={ytThumb(id, 'maxres')}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={(e) => { (e.target as HTMLImageElement).src = ytThumb(id, 'mq'); }}
      />
      {loading && (
        <div className="np-loading-overlay">
          <div className="spinner spinner-lg" />
        </div>
      )}
    </div>
  );
}
