// The plan of a standard close-up, for any stop outside a hero zone: which fixture face the shopper is at,
// the one across the corridor, which overview fixtures the close-up replaces, where its slot is, how far out
// the shopper stands. Pure and cheap (no three.js): the 3D map asks it for every stop to key, hide and
// prepare zones; the zone's builder (zone.ts, in the lazy chunk) turns it into geometry.

import type { StoreGraph, ShelfLocation } from "@grosher/core";
import { fixtureParams, slotFor, type FixtureParams, type Slot } from "@grosher/stores";

export type V2 = [number, number];

/** One face of a fixture, in the map's plane (x, y as scene x, z): the face line's centre, along and out. */
export interface FaceFrame {
  fixtureId: string;
  department: string;
  kind: FixtureParams["kind"];
  /** the fixture's own kind: "wall" (one face), "shelf", "counter", … */
  fixtureKind: string;
  params: FixtureParams;
  origin: V2;
  /** unit, along the face */
  t: V2;
  /** unit, out of the face toward the shopper */
  n: V2;
  length: number;
  /** shelf depth behind the face */
  depth: number;
  height: number;
  shelves: number;
  /** +1 when bay 1 is at the +t end, −1 at the −t end */
  bayDir: 1 | -1;
}

export interface StandardPlan {
  /** the zone's key: one zone per fixture face (two stops at the same face share it) */
  key: string;
  locationId: string;
  /** the face the stop is on, and the one across the corridor (none at a wall or an open floor) */
  face: FaceFrame;
  opposite: FaceFrame | null;
  /** overview fixtures the close-up redraws */
  hide: string[];
  /** the slot: its centre on the face (map x, y), its height above the floor, its size */
  slot: { at: V2; along: number; y: number; h: number; w: number; bay: number; shelf: number };
  /** clear distance between the two faces (or the room in front of a lone face) */
  clearance: number;
}

const add = (a: V2, b: V2, k = 1): V2 => [a[0] + b[0] * k, a[1] + b[1] * k];
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];

/** The frame of fixture `f`'s face looking out along `n`. */
export function faceFrame(store: StoreGraph, fixtureId: string, n: V2): FaceFrame | null {
  const f = store.fixtures?.find((x) => x.id === fixtureId);
  if (!f) return null;
  const p = fixtureParams(f, store.departments);
  const t: V2 = p.vertical ? [0, 1] : [1, 0];
  const half = p.width / 2;
  const origin: V2 = [p.cx + n[0] * half, p.cz + n[1] * half];
  // bay 1 is at the end nearer the entrance
  const ent = store.nodes.find((x) => x.id === store.entranceId);
  const plus: V2 = add([p.cx, p.cz], t, p.length / 2);
  const minus: V2 = add([p.cx, p.cz], t, -p.length / 2);
  const dPlus = ent ? Math.hypot(ent.x - plus[0], ent.y - plus[1]) : 0;
  const dMinus = ent ? Math.hypot(ent.x - minus[0], ent.y - minus[1]) : 1;
  // a wall fixture or a counter has one face: its full depth is behind it
  const oneFaced = f.kind === "wall" || f.kind === "counter" || p.kind === "servicecase" || p.kind === "coldcase";
  return {
    fixtureId: f.id,
    department: f.department ?? "",
    kind: p.kind,
    fixtureKind: f.kind,
    params: p,
    origin,
    t,
    n,
    length: p.length,
    depth: oneFaced ? p.width : p.depth,
    height: p.height,
    shelves: p.shelves,
    bayDir: dPlus <= dMinus ? 1 : -1,
  };
}

const NORMAL: Record<Slot["face"], V2> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };

/** Whether a map point is inside a fixture's footprint. */
function fixtureAt(store: StoreGraph, pt: V2, except: string): string | null {
  for (const f of store.fixtures ?? []) {
    if (f.id === except || f.kind === "selfcheckout") continue;
    const p = fixtureParams(f, store.departments);
    if (Math.abs(pt[0] - p.cx) <= p.w / 2 && Math.abs(pt[1] - p.cz) <= p.d / 2) return f.id;
  }
  return null;
}

export function standardPlan(store: StoreGraph, loc: ShelfLocation): StandardPlan | null {
  const s = slotFor(store, loc);
  if (!s) return null;
  const n = NORMAL[s.face];
  // an endcap's "face" is the run's end: treat it as the long face nearest the corridor instead (the cap's
  // own fixture, when there is one, is what the location found)
  const face = faceFrame(store, s.fixture.id, n);
  if (!face) return null;
  const slotAt: V2 = [s.center.x, s.center.y];
  const along = dot([slotAt[0] - face.origin[0], slotAt[1] - face.origin[1]], face.t);
  // across the corridor: march out from the slot until another fixture's footprint, parallel to this one
  let opposite: FaceFrame | null = null;
  let clearance = 3.2;
  for (let k = 0.3; k <= 5; k += 0.1) {
    const id = fixtureAt(store, add(slotAt, n, k), s.fixture.id);
    if (!id) continue;
    const other = store.fixtures!.find((f) => f.id === id)!;
    const op = fixtureParams(other, store.departments);
    if (op.vertical === s.params.vertical && other.kind !== "counter") opposite = faceFrame(store, id, [-n[0], -n[1]]);
    clearance = k;
    break;
  }
  const bayLen = s.params.length / s.params.bays;
  const shelfGap = s.params.kind === "gondola" || s.params.kind === "coldcase" ? (s.params.height - 0.25) / s.params.shelves : 0.32;
  const hide = [s.fixture.id, ...(opposite ? [opposite.fixtureId] : [])];
  return {
    key: `std:${s.fixture.id}:${s.face}`,
    locationId: loc.id,
    face,
    opposite,
    hide,
    slot: { at: slotAt, along, y: s.heightM, h: Math.min(0.45, shelfGap), w: Math.min(bayLen, 1.3), bay: s.bay, shelf: s.shelf },
    clearance,
  };
}

/** How far out from the face the shopper stands: two metres where there is room, never within 0.45 m of the
 * face across the corridor, never closer than 0.85 m to its own. */
export function standOff(plan: StandardPlan): number {
  return Math.max(0.85, Math.min(2.0, plan.clearance - 0.45));
}
