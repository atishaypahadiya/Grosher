// Slots: where exactly on a fixture a shelf location lives. Shared by the
// editor (bay / shelf picker and highlight), the 3D map (lit slot, product
// layout, item cards) and tests. Pure geometry, no graph.

import type { Department, Fixture, FixtureKind, ShelfLocation, StoreGraph } from "@grosher/core";

export const BAY_M = 1.22; // a standard 4 ft bay
export const DECK_M = 0.15; // base deck height
export const SERVICE_DECK_M = 0.85; // a service case's display deck, under the glass
export const COFFIN_DECK_M = 0.55; // the floor of a coffin freezer's tub

export interface FixtureParams {
  kind: FixtureKind;
  bays: number;
  shelves: number;
  depth: number; // shelf depth from each face
  height: number;
  /** footprint in metres: centre, extent along x and along y (map y = scene z) */
  cx: number;
  cz: number;
  w: number;
  d: number;
  vertical: boolean; // long axis along map y
  length: number; // along the long axis
  width: number; // across
}

export function fixtureKindOf(f: Fixture, departments: Department[] | undefined): FixtureKind {
  if (f.fixtureKind) return f.fixtureKind;
  // a counter is a counter whatever department staffs it (the pharmacy counter, a deli counter)
  if (f.kind === "counter" || f.kind === "selfcheckout" || f.kind === "service") return "counter";
  const dept = departments?.find((x) => x.id === f.department);
  if (dept?.fixtureKind) return dept.fixtureKind;
  return "gondola";
}

export function defaultShelves(kind: FixtureKind): number {
  if (kind === "coldcase") return 4;
  if (kind === "produce" || kind === "bakery") return 3;
  if (kind === "counter" || kind === "coffin") return 1;
  if (kind === "servicecase") return 2;
  if (kind === "bins") return 4;
  return 5;
}

export function fixtureParams(f: Fixture, departments: Department[] | undefined): FixtureParams {
  const xs = f.polygon.map((p) => p[0]);
  const ys = f.polygon.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const w = Math.max(x1 - x0, 0.2);
  const d = Math.max(y1 - y0, 0.2);
  const vertical = d >= w;
  const length = vertical ? d : w;
  const width = vertical ? w : d;
  const kind = fixtureKindOf(f, departments);
  const height = f.height ?? (kind === "counter" ? 1.0 : kind === "bakery" ? 0.95 : kind === "produce" ? 1.1 : kind === "servicecase" ? 1.35 : kind === "coffin" ? 0.9 : kind === "bins" ? 1.9 : 1.8);
  return {
    kind,
    bays: f.bays ?? Math.max(1, Math.round(length / BAY_M)),
    shelves: f.shelves ?? defaultShelves(kind),
    depth: f.depth ?? width / 2,
    height,
    cx: (x0 + x1) / 2,
    cz: (y0 + y1) / 2,
    w,
    d,
    vertical,
    length,
    width,
  };
}

export type Face = "west" | "east" | "north" | "south";

export interface Slot {
  fixture: Fixture;
  params: FixtureParams;
  /** 1-based bay from the fixture's front end (the end nearer the entrance) */
  bay: number;
  /** which face of the block the shelf is on */
  face: Face;
  /** 0 = bottom */
  shelf: number;
  /** the slot's footprint on the flat map, metres */
  rect: { x: number; y: number; w: number; h: number };
  /** centre of the slot on the face, metres, plus the shelf height */
  center: { x: number; y: number };
  heightM: number;
  /** +1 if bay 1 is at the max end of the long axis, −1 if at the min end */
  frontSign: 1 | -1;
}

export function locationPoint(store: StoreGraph, loc: ShelfLocation): { x: number; y: number } | undefined {
  const e = store.edges.find((x) => x.id === loc.edgeId);
  const a = e && store.nodes.find((n) => n.id === e.from);
  const b = e && store.nodes.find((n) => n.id === e.to);
  if (!a || !b) return undefined;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const t = Math.max(0, Math.min(1, loc.offsetM / len));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Which end of the fixture faces the entrance (Euclidean), as the sign of the long axis. */
export function frontSignOf(p: FixtureParams, store: StoreGraph): 1 | -1 {
  const ent = store.nodes.find((n) => n.id === store.entranceId);
  if (!ent) return 1;
  const minEnd = p.vertical ? { x: p.cx, y: p.cz - p.length / 2 } : { x: p.cx - p.length / 2, y: p.cz };
  const maxEnd = p.vertical ? { x: p.cx, y: p.cz + p.length / 2 } : { x: p.cx + p.length / 2, y: p.cz };
  const dMin = Math.hypot(ent.x - minEnd.x, ent.y - minEnd.y);
  const dMax = Math.hypot(ent.x - maxEnd.x, ent.y - maxEnd.y);
  return dMax <= dMin ? 1 : -1;
}

/** The fixture a location sits against: within 3 m, on the location's side of the corridor when it says. */
export function fixtureForLocation(store: StoreGraph, loc: ShelfLocation): Fixture | undefined {
  const pt = locationPoint(store, loc);
  if (!pt) return undefined;
  const edge = store.edges.find((e) => e.id === loc.edgeId);
  const a = edge ? store.nodes.find((n) => n.id === edge.from) : undefined;
  const b = edge ? store.nodes.find((n) => n.id === edge.to) : undefined;
  const corridorVertical = a && b ? Math.abs(b.y - a.y) >= Math.abs(b.x - a.x) : true;
  let best: Fixture | undefined;
  let bd = Infinity;
  for (const f of store.fixtures ?? []) {
    const p = fixtureParams(f, store.departments);
    const dx = Math.max(Math.abs(pt.x - p.cx) - p.w / 2, 0);
    const dz = Math.max(Math.abs(pt.y - p.cz) - p.d / 2, 0);
    let dist = Math.hypot(dx, dz);
    if (dist > 3) continue;
    if (loc.side === "L" || loc.side === "R") {
      const west = p.cx < pt.x;
      const north = p.cz < pt.y;
      const onSide = corridorVertical ? (loc.side === "L" ? west : !west) : loc.side === "L" ? north : !north;
      if (!onSide) dist += 2;
    }
    if (f.aisle && f.aisle !== loc.aisle && !/^A\d+$/i.test(f.aisle)) dist += 1;
    if (dist < bd) {
      bd = dist;
      best = f;
    }
  }
  return best;
}

/** Height of the bottom of shelf level `shelf` on a fixture. */
export function shelfHeight(p: FixtureParams, shelf: number): number {
  const n = Math.max(1, p.shelves);
  const s = Math.max(0, Math.min(n - 1, shelf));
  if (p.kind === "produce") return 0.35 + (s * (p.height - 0.35)) / n;
  if (p.kind === "bakery" || p.kind === "counter") return p.height * 0.6;
  if (p.kind === "servicecase") return SERVICE_DECK_M + s * 0.2;
  if (p.kind === "coffin") return COFFIN_DECK_M;
  return DECK_M + (s * (p.height - DECK_M - 0.1)) / n;
}

export function slotFor(store: StoreGraph, loc: ShelfLocation): Slot | undefined {
  const f = fixtureForLocation(store, loc);
  const pt = locationPoint(store, loc);
  if (!f || !pt) return undefined;
  const p = fixtureParams(f, store.departments);
  const frontSign = frontSignOf(p, store);
  // position along the long axis, measured from the front end
  const along = p.vertical ? pt.y - p.cz : pt.x - p.cx; // −L/2 .. L/2 from the centre
  const fromFront = frontSign === 1 ? p.length / 2 - along : along + p.length / 2;
  const bayLen = p.length / p.bays;
  const endcap = loc.side === "E";
  const bay = endcap ? (fromFront < p.length / 2 ? 1 : p.bays) : Math.max(1, Math.min(p.bays, Math.floor(fromFront / bayLen) + 1));
  // face: the long face nearer the corridor point, or the end for an endcap
  let face: Face;
  if (endcap) face = p.vertical ? (bay === 1 ? (frontSign === 1 ? "south" : "north") : frontSign === 1 ? "north" : "south") : bay === 1 ? (frontSign === 1 ? "east" : "west") : frontSign === 1 ? "west" : "east";
  else if (p.vertical) face = pt.x < p.cx ? "west" : "east";
  else face = pt.y < p.cz ? "north" : "south";
  const shelf = Math.max(0, Math.min(p.shelves - 1, loc.shelf ?? 2));
  // slot rect: the bay's segment along the run × the half-depth on that face
  const bayStart = frontSign === 1 ? p.length / 2 - bay * bayLen : -p.length / 2 + (bay - 1) * bayLen;
  let rect: Slot["rect"];
  let center: { x: number; y: number };
  if (endcap) {
    const endAlong = face === "north" || face === "west" ? -p.length / 2 : p.length / 2;
    rect = p.vertical
      ? { x: p.cx - p.width / 2, y: p.cz + endAlong - (endAlong < 0 ? 0 : 0.6), w: p.width, h: 0.6 }
      : { x: p.cx + endAlong - (endAlong < 0 ? 0 : 0.6), y: p.cz - p.width / 2, w: 0.6, h: p.width };
    center = p.vertical ? { x: p.cx, y: p.cz + endAlong } : { x: p.cx + endAlong, y: p.cz };
  } else if (p.vertical) {
    const x0 = face === "west" ? p.cx - p.width / 2 : p.cx;
    rect = { x: x0, y: p.cz + bayStart, w: p.width / 2, h: bayLen };
    center = { x: face === "west" ? p.cx - p.width / 2 : p.cx + p.width / 2, y: p.cz + bayStart + bayLen / 2 };
  } else {
    const y0 = face === "north" ? p.cz - p.width / 2 : p.cz;
    rect = { x: p.cx + bayStart, y: y0, w: bayLen, h: p.width / 2 };
    center = { x: p.cx + bayStart + bayLen / 2, y: face === "north" ? p.cz - p.width / 2 : p.cz + p.width / 2 };
  }
  return { fixture: f, params: p, bay, face, shelf, rect, center, heightM: shelfHeight(p, shelf), frontSign };
}

/** Offset along the location's edge that puts it at the centre of `bay` of its fixture. */
export function offsetForBay(store: StoreGraph, loc: ShelfLocation, bay: number): number | undefined {
  const slot = slotFor(store, loc);
  const e = store.edges.find((x) => x.id === loc.edgeId);
  const a = e && store.nodes.find((n) => n.id === e.from);
  const b = e && store.nodes.find((n) => n.id === e.to);
  if (!slot || !a || !b) return undefined;
  const { params: p, frontSign } = slot;
  const bayLen = p.length / p.bays;
  const bayCentre = frontSign === 1 ? p.length / 2 - (bay - 0.5) * bayLen : -p.length / 2 + (bay - 0.5) * bayLen;
  const target = p.vertical ? { x: p.cx, y: p.cz + bayCentre } : { x: p.cx + bayCentre, y: p.cz };
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const t = Math.max(0, Math.min(1, ((target.x - a.x) * (b.x - a.x) + (target.y - a.y) * (b.y - a.y)) / (len * len)));
  return Math.round(t * len * 10) / 10;
}
