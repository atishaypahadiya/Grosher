// Underlay image placement, in metres. Pure, so the gestures are testable.

export interface Underlay {
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  aspect: number; // width / height of the source image
  locked: boolean;
}

export const moveBy = (u: Underlay, d: { x: number; y: number }): Underlay => ({ ...u, x: round(u.x + d.x), y: round(u.y + d.y) });

/** Scale about a map point so whatever is under the pointer stays put. Width is clamped to 1–500 m. */
export function scaleAbout(u: Underlay, factor: number, at: { x: number; y: number }): Underlay {
  const w = Math.min(500, Math.max(1, u.w * factor));
  const f = w / u.w;
  const h = w / u.aspect;
  return { ...u, w: round(w), h: round(h), x: round(at.x - (at.x - u.x) * f), y: round(at.y - (at.y - u.y) * f) };
}

export const withWidth = (u: Underlay, w: number): Underlay => ({ ...u, w: round(Math.max(1, w)), h: round(Math.max(1, w) / u.aspect) });

const round = (v: number) => Math.round(v * 100) / 100;
