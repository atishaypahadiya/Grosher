// Which stops on the 3D map get a full card, and which collapse to their numbered dot. Pure, so the
// rule is testable without WebGL; Overlay.tsx applies it every rendered frame.
//
//   - the next stop: the lime card (the next-stop label), always shown, never collapsed
//   - the two stops after it: a card each, unless it would collide on screen with a card already
//     placed (or the checkout callout), or would leave the map area; then it collapses to its dot
//   - every other unvisited stop: its numbered dot only
//   - done stops: ring + check (not cards; not handled here)
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

export interface CardCandidate {
  key: string;
  /** on-screen box, or null when the item is off screen / behind the camera */
  box: Box | null;
  /** placed first and never collapsed: the next-stop card, the checkout callout */
  fixed?: boolean;
}

export const overlaps = (a: Box, b: Box, gap = 0) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;
export const inside = (a: Box, area: Box) => a.x0 >= area.x0 && a.x1 <= area.x1 && a.y0 >= area.y0 && a.y1 <= area.y1;

/**
 * Walks the candidates in priority order (fixed ones first, then the cards in route order) and returns
 * the keys that collapse to their dot: a card that would overlap any box already placed (with `gap`
 * pixels to spare), or that would not fit inside `area`. Fixed boxes are always placed.
 */
export function collapseColliding(candidates: CardCandidate[], area: Box | null, gap = 4): Set<string> {
  const placed: Box[] = [];
  const collapsed = new Set<string>();
  const ordered = [...candidates.filter((c) => c.fixed), ...candidates.filter((c) => !c.fixed)];
  for (const c of ordered) {
    if (!c.box) continue;
    if (c.fixed) {
      placed.push(c.box);
      continue;
    }
    if ((area && !inside(c.box, area)) || placed.some((p) => overlaps(c.box!, p, gap))) {
      collapsed.add(c.key);
      continue;
    }
    placed.push(c.box);
  }
  return collapsed;
}
