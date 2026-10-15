/**
 * Minimal stroke icon set (24x24 grid, 1.75px strokes). Inline SVG keeps the
 * bundle tiny and lets icons inherit `currentColor`.
 */
const base = (children, { fill = false } = {}) =>
  function Icon({ size = 20, className = '', style, ...rest }) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={fill ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={fill ? 0 : 1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`icon ${className}`}
        style={style}
        aria-hidden="true"
        {...rest}
      >
        {children}
      </svg>
    );
  };

export const Bell = base(
  <>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </>,
);
export const UserPlus = base(
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M19 8v6M22 11h-6" />
  </>,
);
export const Users = base(
  <>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </>,
);
export const Chat = base(
  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
);
export const Queue = base(
  <>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" strokeWidth="2.5" />
  </>,
);
export const Poll = base(<path d="M12 20v-9M18 20V5M6 20v-4" strokeWidth="2.2" />);
export const Sliders = base(
  <>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
    <path d="M1 14h6M9 8h6M17 16h6" />
  </>,
);
export const Play = base(<path d="M6 4.5v15a.5.5 0 0 0 .76.43l12.5-7.5a.5.5 0 0 0 0-.86L6.76 4.07A.5.5 0 0 0 6 4.5z" />, { fill: true });
export const Pause = base(
  <>
    <rect x="5" y="4" width="5" height="16" rx="1.2" />
    <rect x="14" y="4" width="5" height="16" rx="1.2" />
  </>,
  { fill: true },
);
export const Back10 = base(
  <>
    <path d="M3 4v6h6" />
    <path d="M3.5 15a9 9 0 1 0 2.1-9.4L3 10" />
    <text x="12" y="16" fontSize="7" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">
      10
    </text>
  </>,
);
export const Fwd10 = base(
  <>
    <path d="M21 4v6h-6" />
    <path d="M20.5 15a9 9 0 1 1-2.1-9.4L21 10" />
    <text x="12" y="16" fontSize="7" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">
      10
    </text>
  </>,
);
export const Volume = base(
  <>
    <path d="M11 5 6 9H2v6h4l5 4V5z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5.5a9.5 9.5 0 0 1 0 13" />
  </>,
);
export const VolumeOff = base(
  <>
    <path d="M11 5 6 9H2v6h4l5 4V5z" />
    <path d="m23 9-6 6M17 9l6 6" />
  </>,
);
export const Maximize = base(<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />);
export const Minimize = base(<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />);
export const Refresh = base(
  <>
    <path d="M23 4v6h-6M1 20v-6h6" />
    <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
  </>,
);
export const Plus = base(<path d="M12 5v14M5 12h14" />);
export const X = base(<path d="M18 6 6 18M6 6l12 12" />);
export const ArrowLeft = base(<path d="M19 12H5M12 19l-7-7 7-7" />);
export const Search = base(
  <>
    <circle cx="11" cy="11" r="7.5" />
    <path d="m21 21-4.6-4.6" />
  </>,
);
export const Smile = base(
  <>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
    <path d="M9 9h.01M15 9h.01" strokeWidth="2.5" />
  </>,
);
export const Film = base(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2.5" />
    <path d="M7 3v18M17 3v18M3 12h18M3 7.5h4M3 16.5h4M17 7.5h4M17 16.5h4" />
  </>,
);
export const Key = base(
  <>
    <circle cx="8" cy="15" r="4.5" />
    <path d="m11.2 11.8 8.3-8.3M15 7l3 3M18 4l2.5 2.5" />
  </>,
);
export const Globe = base(
  <>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M2.5 12h19M12 2.5a14.5 14.5 0 0 1 0 19M12 2.5a14.5 14.5 0 0 0 0 19" />
  </>,
);
export const Lock = base(
  <>
    <rect x="4" y="11" width="16" height="10" rx="2.5" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </>,
);
export const Crown = base(<path d="M3 18h18l1.5-10-5.5 4L12 5l-5 7-5.5-4z" />, { fill: true });
export const Tv = base(
  <>
    <rect x="2.5" y="7" width="19" height="13.5" rx="2.5" />
    <path d="m16.5 2.5-4.5 4.5-4.5-4.5" />
  </>,
);
export const Copy = base(
  <>
    <rect x="9" y="9" width="12" height="12" rx="2.5" />
    <path d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5" />
  </>,
);
export const Check = base(<path d="m20 6-11 11-5-5" />);
export const ChevronDown = base(<path d="m6 9 6 6 6-6" />);
export const ChevronRight = base(<path d="m9 18 6-6-6-6" />);
export const LogOut = base(
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </>,
);
export const Sparkles = base(<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8zM5 3l.7 1.8L7.5 5.5l-1.8.7L5 8l-.7-1.8L2.5 5.5l1.8-.7z" />, { fill: true });
export const External = base(
  <>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6M10 14 21 3" />
  </>,
);
export const Camera = base(
  <>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </>,
);
export const ThumbsUp = base(<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.3a2 2 0 0 0 2-1.7l1.4-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />);
export const Trash = base(
  <>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </>,
);
export const Send = base(<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />);
export const Shield = base(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />);
export const Clock = base(
  <>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 7v5l3 2" />
  </>,
);
export const Zap = base(<path d="M13 2 3 14h9l-1 8 10-12h-9z" />);
export const Popcorn = base(
  <>
    <path d="M6 9l1.5 12h9L18 9" />
    <path d="M4.5 9h15" />
    <path d="M7 9a3 3 0 0 1 2-5 3 3 0 0 1 3-2 3 3 0 0 1 3 2 3 3 0 0 1 2 5" />
    <path d="M10 9v12M14 9v12" />
  </>,
);
export const Spinner = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className="icon spin" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);
