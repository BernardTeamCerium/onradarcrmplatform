/** OnRadar mark: open radar ring, sweep beam and centre blip (after onradarcrm.com). */
export function RadarIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="or-sweep" x1="32" y1="32" x2="58" y2="4" gradientUnits="userSpaceOnUse">
          <stop stopColor="#35E6A5" />
          <stop offset="1" stopColor="#35E6A5" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M32 6a26 26 0 1 0 26 26" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
      <path d="M32 32 56 8l6 6-30 18z" fill="url(#or-sweep)" />
      <circle cx="32" cy="32" r="6" fill="#35E6A5" />
    </svg>
  );
}

export function Brandmark() {
  return (
    <>
      <RadarIcon />
      <span style={{ letterSpacing: "-0.03em" }}>
        OnRadar<sup style={{ fontSize: "0.5em", fontWeight: 500, opacity: 0.55 }}>™</sup>
      </span>
    </>
  );
}
