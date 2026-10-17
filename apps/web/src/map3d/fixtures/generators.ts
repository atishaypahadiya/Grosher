// Fixture generators (DESIGN.md §3): one per department fixture kind.
// Output is a set of geometry lists in map space: opaque parts (textured),
// glass doors, door frames and interior glow panels for cold cases.

import { DECK_M, shelfHeight, type FixtureParams } from "@grosher/stores";
import { box, emptyParts, panel, place, type Parts } from "./parts.ts";

const UPRIGHT = 0.05;
const SHELF_T = 0.03;
const END = 0.06;

/** Which long faces are open: both for a free-standing run, one for a wall run. +1 = +z face (local), −1 = −z. */
function openFaces(p: FixtureParams, wall: boolean, towardCentre: 1 | -1): (1 | -1)[] {
  return wall ? [towardCentre] : [1, -1];
}

function shelvesAndUprights(parts: Parts, p: FixtureParams, faces: (1 | -1)[], repeat: number) {
  const L = p.length;
  const W = p.width;
  const H = p.height;
  // base deck and central spine
  parts.opaque.push(box(L, DECK_M, W, 0, DECK_M / 2, 0, repeat));
  parts.opaque.push(box(L, H - DECK_M, 0.04, 0, DECK_M + (H - DECK_M) / 2, 0, repeat));
  // uprights at every bay boundary
  const bayLen = L / p.bays;
  for (let b = 0; b <= p.bays; b++) {
    const x = -L / 2 + b * bayLen;
    parts.opaque.push(box(UPRIGHT, H, W * 0.9, x, H / 2, 0, repeat));
  }
  // shelf planes per level, per open face, one long plane each
  const depth = Math.min(p.depth, W / 2);
  for (let s = 0; s < p.shelves; s++) {
    const y = shelfHeight(p, s);
    for (const f of faces) parts.opaque.push(box(L - 2 * END, SHELF_T, depth, 0, y + SHELF_T / 2, f * (W / 2 - depth / 2), repeat));
  }
  // end panels
  parts.opaque.push(box(END, H, W, -L / 2 + END / 2, H / 2, 0, repeat));
  parts.opaque.push(box(END, H, W, L / 2 - END / 2, H / 2, 0, repeat));
}

export function gondola(p: FixtureParams, repeat: number, wall: boolean, towardCentre: 1 | -1): Parts {
  const parts = emptyParts();
  shelvesAndUprights(parts, p, openFaces(p, wall, towardCentre), repeat);
  return { ...parts, opaque: place(parts.opaque, p) };
}

export function coldcase(p: FixtureParams, repeat: number, wall: boolean, towardCentre: 1 | -1): Parts {
  const parts = emptyParts();
  const faces = openFaces(p, wall, towardCentre);
  shelvesAndUprights(parts, p, faces, repeat);
  const L = p.length;
  const W = p.width;
  const H = p.height;
  const bayLen = L / p.bays;
  const doorH = H - DECK_M - 0.05;
  const doorY = DECK_M + doorH / 2;
  for (const f of faces) {
    const z = f * (W / 2 + 0.01);
    for (let b = 0; b < p.bays; b++) {
      const x = -L / 2 + (b + 0.5) * bayLen;
      // glass door, slightly narrower than the bay; frosted frame around it; glow panel behind
      parts.glass.push(panel(bayLen - 0.08, doorH - 0.06, x, doorY, z, f === -1));
      parts.frame.push(box(bayLen, 0.04, 0.03, x, DECK_M + 0.02, z));
      parts.frame.push(box(bayLen, 0.04, 0.03, x, H - 0.05, z));
      parts.frame.push(box(0.04, doorH, 0.03, x - bayLen / 2 + 0.02, doorY, z));
      parts.frame.push(box(0.04, doorH, 0.03, x + bayLen / 2 - 0.02, doorY, z));
      parts.glow.push(panel(bayLen - 0.12, doorH - 0.12, x, doorY, f * 0.05, f === -1));
    }
  }
  return {
    opaque: place(parts.opaque, p),
    glass: place(parts.glass, p),
    frame: place(parts.frame, p),
    glow: place(parts.glow, p),
  };
}

/** Tiered open table: three stepped levels, no uprights. */
export function produce(p: FixtureParams, repeat: number): Parts {
  const parts = emptyParts();
  const L = p.length;
  const W = p.width;
  const H = p.height;
  const levels = Math.max(1, Math.min(3, p.shelves));
  for (let s = 0; s < levels; s++) {
    const frac = 1 - s * (0.33 * (3 / levels));
    const y0 = s === 0 ? 0 : shelfHeight(p, s - 1) + 0.05;
    const y1 = s === levels - 1 ? H : shelfHeight(p, s) + 0.05;
    parts.opaque.push(box(L - s * 0.3, Math.max(0.1, y1 - y0), W * Math.max(0.3, frac), 0, (y0 + y1) / 2, 0, repeat));
  }
  return { ...parts, opaque: place(parts.opaque, p) };
}

/** Low table with a rim. */
export function bakery(p: FixtureParams, repeat: number): Parts {
  const parts = emptyParts();
  const L = p.length;
  const W = p.width;
  const H = p.height;
  parts.opaque.push(box(L, H - 0.08, W, 0, (H - 0.08) / 2, 0, repeat));
  const rimH = 0.08;
  const rimT = 0.06;
  parts.opaque.push(box(L, rimH, rimT, 0, H - rimH / 2, W / 2 - rimT / 2, repeat));
  parts.opaque.push(box(L, rimH, rimT, 0, H - rimH / 2, -W / 2 + rimT / 2, repeat));
  parts.opaque.push(box(rimT, rimH, W, L / 2 - rimT / 2, H - rimH / 2, 0, repeat));
  parts.opaque.push(box(rimT, rimH, W, -L / 2 + rimT / 2, H - rimH / 2, 0, repeat));
  return { ...parts, opaque: place(parts.opaque, p) };
}

/** Checkout: belt plus a register block at the front end. */
export function counter(p: FixtureParams, repeat: number, frontSign: 1 | -1): Parts {
  const parts = emptyParts();
  const L = p.length;
  const W = p.width;
  const H = p.height;
  parts.opaque.push(box(L - 0.6, H * 0.85, W * 0.6, -frontSign * 0.3, (H * 0.85) / 2, 0, repeat));
  parts.opaque.push(box(0.6, H * 1.3, W * 0.8, frontSign * (L / 2 - 0.3), (H * 1.3) / 2, 0, repeat));
  return { ...parts, opaque: place(parts.opaque, p) };
}

export function generate(p: FixtureParams, repeat: number, opts: { wall: boolean; towardCentre: 1 | -1; frontSign: 1 | -1 }): Parts {
  switch (p.kind) {
    case "coldcase":
      return coldcase(p, repeat, opts.wall, opts.towardCentre);
    case "produce":
      return produce(p, repeat);
    case "bakery":
      return bakery(p, repeat);
    case "counter":
      return counter(p, repeat, opts.frontSign);
    default:
      return gondola(p, repeat, opts.wall, opts.towardCentre);
  }
}
