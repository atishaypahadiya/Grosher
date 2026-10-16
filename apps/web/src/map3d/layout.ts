// Pure helpers shared by the 3D scene: fixture boxes, sign placement, which
// fixture a stop lives in, and the camera framing for a leg.

import type { Fixture, GraphNode, StoreGraph } from "@grosher/core";

export interface Box {
  id: string;
  cx: number; // metres, map x
  cz: number; // metres, map y → scene z
  w: number; // extent along x
  d: number; // extent along z
  h: number; // height
  department?: string;
  aisle?: string;
  polygon: [number, number][];
}

export function fixtureBox(f: Fixture): Box {
  const xs = f.polygon.map((p) => p[0]);
  const ys = f.polygon.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  return {
    id: f.id,
    cx: (x0 + x1) / 2,
    cz: (y0 + y1) / 2,
    w: Math.max(x1 - x0, 0.2),
    d: Math.max(y1 - y0, 0.2),
    h: f.height ?? (f.kind === "counter" ? 1.0 : 1.8),
    department: f.department,
    aisle: f.aisle,
    polygon: f.polygon,
  };
}

/** Which end of a box faces the entrance (by walking distance through the graph). */
export function frontOf(box: Box, nodes: Map<string, GraphNode>, fromEntrance: Map<string, number>): { x: number; z: number; nx: number; nz: number; width: number } {
  const vertical = box.d >= box.w;
  const ends = vertical
    ? [
        { x: box.cx, z: box.cz - box.d / 2, nx: 0, nz: -1, width: box.w },
        { x: box.cx, z: box.cz + box.d / 2, nx: 0, nz: 1, width: box.w },
      ]
    : [
        { x: box.cx - box.w / 2, z: box.cz, nx: -1, nz: 0, width: box.d },
        { x: box.cx + box.w / 2, z: box.cz, nx: 1, nz: 0, width: box.d },
      ];
  const near = (p: { x: number; z: number }) => {
    let best = Infinity;
    for (const n of nodes.values()) {
      const d = fromEntrance.get(n.id);
      if (d === undefined) continue;
      const dd = Math.hypot(n.x - p.x, n.y - p.z);
      if (dd < 3) best = Math.min(best, d + dd);
    }
    return best;
  };
  return near(ends[0]) <= near(ends[1]) ? ends[0] : ends[1];
}

/**
 * The fixture that holds a shelf location: the block beside the corridor on
 * the location's side (L = west / north of the corridor, R = east / south),
 * else simply the nearest block within reach.
 */
export function fixtureForLocation(store: StoreGraph, locationId: string | undefined, pt: { x: number; y: number } | undefined): Fixture | undefined {
  if (!locationId || !pt) return undefined;
  const loc = store.locations.find((l) => l.id === locationId);
  if (!loc) return undefined;
  const edge = store.edges.find((e) => e.id === loc.edgeId);
  const a = edge ? store.nodes.find((n) => n.id === edge.from) : undefined;
  const b = edge ? store.nodes.find((n) => n.id === edge.to) : undefined;
  const vertical = a && b ? Math.abs(b.y - a.y) >= Math.abs(b.x - a.x) : true;
  let best: Fixture | undefined;
  let bd = Infinity;
  for (const f of store.fixtures ?? []) {
    const box = fixtureBox(f);
    const dx = Math.max(Math.abs(pt.x - box.cx) - box.w / 2, 0);
    const dz = Math.max(Math.abs(pt.y - box.cz) - box.d / 2, 0);
    let d = Math.hypot(dx, dz);
    if (d > 3) continue;
    if (loc.side) {
      const west = box.cx < pt.x;
      const north = box.cz < pt.y;
      const onSide = vertical ? (loc.side === "L" ? west : !west) : loc.side === "L" ? north : !north;
      if (!onSide) d += 2;
    }
    if (f.aisle && f.aisle !== loc.aisle && !/^A\d+$/i.test(f.aisle ?? "")) d += 1;
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return best;
}

/** Pinch range. The design says 12–60 m; the whole demo store needs ~90 m at a 42° horizontal field. */
export const MIN_DISTANCE = 12;
export const MAX_DISTANCE = 90;

export interface Framing {
  tx: number;
  tz: number;
  distance: number;
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
