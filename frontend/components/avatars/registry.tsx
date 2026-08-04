import type { SVGProps } from "react";
import { AVATAR_KEYS, type AvatarKey } from "@/shared/utilities/avatars";

// Eight preset avatars — warm, abstract, adult, reassuring. Deliberately NOT
// photographic and NOT childish: each is a flat two-tone geometric mark
// inside a circle, distinguished by SHAPE as well as colour (so meaning is
// never conveyed by colour alone — Stage C brief §10), and carries no
// information about a person's gender, age, ethnicity or health, since an
// abstract shape has none to carry.
//
// No <defs>/gradient with a fixed id: these render many times on one page
// (a dashboard full of profile cards, a history list), and a fixed SVG id
// would collide across instances. Flat, solid two-tone fills only.
//
// `title` is intentionally NOT rendered inside these graphics — the
// accessible name belongs to the calling component (Avatar, in avatar.tsx),
// which knows whose avatar this is; the shape itself has no inherent meaning
// to describe.
type AvatarGraphicProps = SVGProps<SVGSVGElement>;

function Base({ fill, children, ...rest }: { fill: string } & AvatarGraphicProps) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden {...rest}>
      <circle cx="24" cy="24" r="24" fill={fill} />
      {children}
    </svg>
  );
}

// Rising concentric arcs over a horizon — a new day, a check-in call.
export function AvatarSunrise(props: AvatarGraphicProps) {
  return (
    <Base fill="#f6dcc3" {...props}>
      <path d="M6 30a18 18 0 0 1 36 0z" fill="#d97a3f" />
      <rect x="0" y="30" width="48" height="18" fill="#c7602a" />
    </Base>
  );
}

// Two soft, overlapping leaf-like ellipses.
export function AvatarOlive(props: AvatarGraphicProps) {
  return (
    <Base fill="#e3e6cf" {...props}>
      <ellipse cx="19" cy="22" rx="12" ry="8" fill="#828f4f" transform="rotate(-25 19 22)" />
      <ellipse cx="30" cy="28" rx="12" ry="8" fill="#5f6b38" transform="rotate(-25 30 28)" />
    </Base>
  );
}

// Stacked horizontal bands, like layered clay or pottery.
export function AvatarTerracotta(props: AvatarGraphicProps) {
  return (
    <Base fill="#f1d9c8" {...props}>
      <rect x="0" y="14" width="48" height="8" fill="#c1673f" />
      <rect x="0" y="24" width="48" height="8" fill="#a24d2c" />
      <rect x="0" y="34" width="48" height="8" fill="#7d3a20" />
    </Base>
  );
}

// A three-petal cluster, softly overlapping.
export function AvatarLavender(props: AvatarGraphicProps) {
  return (
    <Base fill="#e9e2f3" {...props}>
      <circle cx="24" cy="16" r="10" fill="#9d84c4" />
      <circle cx="15" cy="30" r="10" fill="#7f63aa" />
      <circle cx="33" cy="30" r="10" fill="#8e73b8" />
    </Base>
  );
}

// Curved horizontal wave bands.
export function AvatarOcean(props: AvatarGraphicProps) {
  return (
    <Base fill="#d7e8ea" {...props}>
      <path d="M0 20q12-8 24 0t24 0v10q-12-8-24 0t-24 0z" fill="#3f8b96" />
      <path d="M0 32q12-8 24 0t24 0v16H0z" fill="#2b6873" />
    </Base>
  );
}

// Layered rounded hill silhouettes.
export function AvatarMeadow(props: AvatarGraphicProps) {
  return (
    <Base fill="#dfead9" {...props}>
      <path d="M-4 34a30 18 0 0 1 30-12 30 18 0 0 1 26 12z" fill="#7fa15c" />
      <path d="M-4 40a34 14 0 0 1 30-8 34 14 0 0 1 26 8v8H-4z" fill="#547a3c" />
    </Base>
  );
}

// A faceted gem/hexagon.
export function AvatarAmber(props: AvatarGraphicProps) {
  return (
    <Base fill="#f7e6b8" {...props}>
      <polygon points="24,8 38,16 38,32 24,40 10,32 10,16" fill="#d9a521" />
      <polygon points="24,8 38,16 24,24 10,16" fill="#efc456" />
    </Base>
  );
}

// A rosette of overlapping circles, arranged in a ring rather than a cluster
// (distinct from lavender's three-petal layout).
export function AvatarRose(props: AvatarGraphicProps) {
  return (
    <Base fill="#f4dde1" {...props}>
      <circle cx="24" cy="14" r="8" fill="#c97a89" />
      <circle cx="35" cy="24" r="8" fill="#b66474" />
      <circle cx="24" cy="34" r="8" fill="#c97a89" />
      <circle cx="13" cy="24" r="8" fill="#b66474" />
    </Base>
  );
}

export const AVATAR_REGISTRY: Record<AvatarKey, (props: AvatarGraphicProps) => React.ReactElement> = {
  sunrise: AvatarSunrise,
  olive: AvatarOlive,
  terracotta: AvatarTerracotta,
  lavender: AvatarLavender,
  ocean: AvatarOcean,
  meadow: AvatarMeadow,
  amber: AvatarAmber,
  rose: AvatarRose,
};

export { AVATAR_KEYS };
export type { AvatarKey };
