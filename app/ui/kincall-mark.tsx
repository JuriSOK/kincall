// The KinCall icon mark — two rounded forms leaning into each other, read
// together as a single heart. Redrawn as a clean vector (replacing the
// earlier raster logo) so it is always crisp, themes correctly with
// --kc-brand-blue/--kc-brand-cyan in dark mode, and never needs cropping.
// The two halves share one continuous gradient and meet at a faint seam
// down the centre — the "two people" reading without literal figures, which
// tend to look cluttered at small sizes.
//
// `decorative`: pass true when adjacent visible/accessible text already
// names it (e.g. the nav brand link's own "KinCall dashboard" aria-label) —
// this hides the mark from assistive tech (aria-hidden, no role/label) so it
// is never announced a second time alongside that text. Leave it false
// (default) wherever the mark is the ONLY thing identifying what it is.
export function KinCallMark({
  className,
  decorative = false,
}: {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      {...(decorative ? { "aria-hidden": "true" } : { role: "img", "aria-label": "KinCall" })}
    >
      <defs>
        <linearGradient id="kc-mark-gradient" x1="0" y1="0" x2="100" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--kc-brand-blue)" />
          <stop offset="100%" stopColor="var(--kc-brand-cyan)" />
        </linearGradient>
      </defs>
      <path
        d="M50,90 C15,66 0,41 0,25 C0,10 12,0 25,0 C35,0 45,6 50,18 C55,6 65,0 75,0 C88,0 100,10 100,25 C100,41 85,66 50,90 Z"
        fill="url(#kc-mark-gradient)"
      />
      <path
        d="M50,18 L50,90"
        stroke="#ffffff"
        strokeOpacity="0.35"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
