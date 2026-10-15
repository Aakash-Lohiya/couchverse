/**
 * CouchVerse mark: a couch silhouette with a play cut-out, on a violet→cyan tile.
 * `animate` draws the glyph with a stroke animation (used by the splash loader).
 */
export function LogoMark({ size = 32, animate = false, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={`logo-mark ${animate ? 'draw' : ''} ${className}`} aria-hidden="true">
      <defs>
        <linearGradient id="cv-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#cv-g)" className="tile" />
      <g className="glyph" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        {/* backrest */}
        <path d="M18 30v-7a5 5 0 0 1 5-5h18a5 5 0 0 1 5 5v7" />
        {/* seat + arms */}
        <path d="M12 30a4 4 0 0 1 4 4v3h32v-3a4 4 0 0 1 8 0v8a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4z" />
        {/* legs */}
        <path d="M14 46v4M50 46v4" />
      </g>
      {/* play cut-out */}
      <path d="M29.5 24.5v9l7.5-4.5z" fill="#fff" className="play" />
    </svg>
  );
}

export function Logo({ size = 30, wordmark = true, className = '' }) {
  return (
    <span className={`logo ${className}`}>
      <LogoMark size={size} />
      {wordmark && (
        <span className="wordmark">
          Couch<span className="accent-text">Verse</span>
        </span>
      )}
    </span>
  );
}

/** Full-screen loading splash shown while the session is restored. */
export function Splash({ leaving = false }) {
  return (
    <div className={`splash-loader ${leaving ? 'leaving' : ''}`} role="status" aria-label="Loading CouchVerse">
      <LogoMark size={84} animate />
      <div className="splash-word">
        Couch<span className="accent-text">Verse</span>
      </div>
      <div className="splash-bar">
        <i />
      </div>
    </div>
  );
}
