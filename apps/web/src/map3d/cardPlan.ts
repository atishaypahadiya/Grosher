// Where the next stops' cards go on the 3D map. Pure, so the rule is testable without WebGL;
// Overlay.tsx feeds it the projected points and measured sizes every rendered frame.
//
//   - the next stop: the lime card (the next-stop label), always shown, placed first
//   - the checkout callout: placed with it, never moved
//   - the two stops after the next one, in route order:
//       on the map  -> a card above its point (sliding sideways to stay in the map area);
//                      if that card hits the lime card or the checkout callout, it stacks directly below
//                      the box it hit (or below a card already stacked there) with a 1 px leader to its dot,
//                      aligned to the dot's side (or flush beside the lime leader line under the lime card)
//                      so it never covers that line;
//                      if that fails too, it folds to its numbered dot
//       off the map -> an edge chip (number, name, distance, arrow) pinned to the map area's edge along
//                      the ray from the area's centre to the stop; chips slide along their edge so they never
//                      overlap each other or a card, and never leave the map area (the header and sheet)
//   - every later unvisited stop: its numbered dot only; done stops: ring + check (not handled here)
// Same rule at every camera distance and in the flattened view.

/** cards on the map: the next stop and the two after it */
export const CARD_COUNT = 3;

/** a stop after the next one (index 0 = the one right after next) may show a card */
export const mayShowCard = (aheadIndex: number) => aheadIndex < CARD_COUNT - 1;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export const overlaps = (a: Box, b: Box, gap = 0) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;
export const inside = (a: Box, area: Box) => a.x0 >= area.x0 && a.x1 <= area.x1 && a.y0 >= area.y0 && a.y1 <= area.y1;
const insidePt = (p: Pt, area: Box) => p.x >= area.x0 && p.x <= area.x1 && p.y >= area.y0 && p.y <= area.y1;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const boxAt = (cx: number, cy: number, s: Size): Box => ({ x0: cx - s.w / 2, x1: cx + s.w / 2, y0: cy - s.h / 2, y1: cy + s.h / 2 });

export interface FixedLabel {
  key: string;
  /** on-screen box, or null when not shown */
  box: Box | null;
}

export interface StopInput {
  key: string;
  /** the projected point on screen (mirrored when behind the camera, see `behind`) */
  point: Pt;
  /** the point is behind the camera: its projection is mirrored, so the chip's ray is flipped */
  behind: boolean;
  card: Size;
  chip: Size;
}

export type Placement =
  | { key: string; mode: "card"; box: Box }
  | { key: string; mode: "stacked"; box: Box; under: string; leader: { x0: number; y0: number; x1: number; y1: number } }
  | { key: string; mode: "chip"; box: Box; angle: number }
  | { key: string; mode: "dot" };

export interface PlanInput {
  /** the map area: between the progress strip and the sheet, inset from the screen edges */
  area: Box;
  /** the lime next-stop card and the checkout callout */
  fixed: FixedLabel[];
  /** the (at most two) stops after the next one, in route order */
  stops: StopInput[];
  /** boxes nothing may cover but nothing stacks under: the next stop's lime dot and its leader line */
  obstacles?: Box[];
  /** px between a stop's point and the bottom of its card */
  lift?: number;
  /** px every placed box keeps clear of the others */
  gap?: number;
}

/** The card above its point, slid sideways to stay inside the area's width. */
export function cardAbove(p: Pt, s: Size, area: Box, lift: number): Box {
  const cx = clamp(p.x, area.x0 + s.w / 2, area.x1 - s.w / 2);
  return { x0: cx - s.w / 2, x1: cx + s.w / 2, y0: p.y - lift - s.h, y1: p.y - lift };
}

/** The nearest point of `b` to `p`: where a leader from the dot meets its card. */
export const nearestOnBox = (p: Pt, b: Box): Pt => ({ x: clamp(p.x, b.x0, b.x1), y: clamp(p.y, b.y0, b.y1) });

/**
 * Where the ray from `centre` towards `target` leaves `area`, inset by half the chip, so the chip sits on
 * the edge and inside the area. Returns the chip's centre, the edge it is on and the ray's angle (radians,
 * screen space, y down; 0 points right).
 */
export function edgeAnchor(centre: Pt, target: Pt, s: Size, area: Box, flip = false): { c: Pt; side: "x" | "y"; angle: number } {
  let dx = target.x - centre.x;
  let dy = target.y - centre.y;
  if (flip) {
    dx = -dx;
    dy = -dy;
  }
  if (Math.hypot(dx, dy) < 1e-6) dy = 1;
  const ix0 = area.x0 + s.w / 2;
  const ix1 = area.x1 - s.w / 2;
  const iy0 = area.y0 + s.h / 2;
  const iy1 = area.y1 - s.h / 2;
  const tx = dx > 0 ? (ix1 - centre.x) / dx : dx < 0 ? (ix0 - centre.x) / dx : Infinity;
  const ty = dy > 0 ? (iy1 - centre.y) / dy : dy < 0 ? (iy0 - centre.y) / dy : Infinity;
  const t = Math.max(0, Math.min(tx, ty));
  return {
    c: { x: clamp(centre.x + dx * t, ix0, ix1), y: clamp(centre.y + dy * t, iy0, iy1) },
    // pinned to a left / right edge: the chip slides vertically; to the top / bottom: horizontally
    side: tx <= ty ? "x" : "y",
    angle: Math.atan2(dy, dx),
  };
}

export function planCards(input: PlanInput): Placement[] {
  const { area, lift = 6, gap = 4 } = input;
  const fixed = input.fixed.filter((f): f is { key: string; box: Box } => !!f.box);
  const placed: Box[] = [...fixed.map((f) => f.box), ...(input.obstacles ?? [])];
  /** cards stacked under each fixed label so far, in order */
  const stacks = new Map<string, Box[]>();
  const clear = (b: Box, against: Box[] = placed) => inside(b, area) && !against.some((p) => overlaps(b, p, gap));
  const out = new Map<string, Placement>();
  const offMap: StopInput[] = [];

  for (const s of input.stops) {
    if (s.behind || !insidePt(s.point, area)) {
      offMap.push(s);
      continue;
    }
    const above = cardAbove(s.point, s.card, area, lift);
    if (clear(above)) {
      placed.push(above);
      out.set(s.key, { key: s.key, mode: "card", box: above });
      continue;
    }
    // stack before fold: only when the card hits the lime card or the checkout callout
    const hit = fixed.find((f) => overlaps(above, f.box, gap));
    let stacked: Placement | null = null;
    if (hit) {
      const stack = stacks.get(hit.key) ?? [];
      const over = stack.length ? stack[stack.length - 1] : hit.box;
      // directly below: aligned to the hit box's edge on the dot's side, else centred, else the other edge
      const { x0, x1 } = hit.box;
      const dotLeft = s.point.x < (x0 + x1) / 2;
      const aligned = dotLeft ? [x0, (x0 + x1 - s.card.w) / 2, x1 - s.card.w] : [x1 - s.card.w, (x0 + x1 - s.card.w) / 2, x0];
      // then flush against either side of anything in the way (the lime leader), nearest the dot first
      const flush = placed
        .flatMap((p) => [p.x0 - gap - s.card.w, p.x1 + gap])
        .sort((a, b) => Math.abs(a + s.card.w / 2 - s.point.x) - Math.abs(b + s.card.w / 2 - s.point.x));
      const box = [...aligned, ...flush]
        .map((l) => clamp(l, area.x0, area.x1 - s.card.w))
        .map((l): Box => ({ x0: l, x1: l + s.card.w, y0: over.y1 + gap, y1: over.y1 + gap + s.card.h }))
        .find((b) => clear(b));
      if (box) {
        const end = nearestOnBox(s.point, box);
        stacked = { key: s.key, mode: "stacked", box, under: hit.key, leader: { x0: s.point.x, y0: s.point.y, x1: end.x, y1: end.y } };
        stacks.set(hit.key, [...stack, box]);
        placed.push(box);
      }
    }
    out.set(s.key, stacked ?? { key: s.key, mode: "dot" });
  }

  // edge chips go last, so cards on the map keep their natural places; a chip slides along its edge
  // to clear the cards and the other chip; if only the chips can be kept apart, they are
  const chips: Box[] = [];
  for (const s of offMap) {
    const { c, side, angle } = edgeAnchor({ x: (area.x0 + area.x1) / 2, y: (area.y0 + area.y1) / 2 }, s.point, s.chip, area, s.behind);
    const step = (side === "x" ? s.chip.h : s.chip.w) + gap;
    const at = (k: number) => {
      const cx = side === "y" ? clamp(c.x + k * step, area.x0 + s.chip.w / 2, area.x1 - s.chip.w / 2) : c.x;
      const cy = side === "x" ? clamp(c.y + k * step, area.y0 + s.chip.h / 2, area.y1 - s.chip.h / 2) : c.y;
      return boxAt(cx, cy, s.chip);
    };
    const tries = [0, 1, -1, 2, -2, 3, -3, 4, -4];
    const box = tries.map(at).find((b) => clear(b, [...placed, ...chips])) ?? tries.map(at).find((b) => clear(b, chips)) ?? null;
    if (!box) {
      out.set(s.key, { key: s.key, mode: "dot" });
      continue;
    }
    chips.push(box);
    placed.push(box);
    out.set(s.key, { key: s.key, mode: "chip", box, angle });
  }
  return input.stops.map((s) => out.get(s.key)!);
}
