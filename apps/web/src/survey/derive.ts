// A survey → metres → a draft map. Pure: the same survey and stride always give the same draft, so the
// editor can re-derive after the stride is fixed.
//
// Metres. Each leg (the walk between two taps) is steps × stride, or, without motion, seconds × the
// calibrated pace. Its direction is the mean compass heading over the leg, relative to the reference axis
// (the heading at the entrance tap, "into the store"), snapped to the nearest right angle when within
// SNAP_DEG, since store aisles run on a grid. Without a compass, aisles run along the axis and every
// other leg across it. Dead reckoning from the entrance at (0, 0) gives every tap a point; "into the
// store" is up on the map (−y), right is +x.
//
// The draft (the editor's store format). Every tap is a node (within 0.8 m of another: the same node), the
// walk between taps an edge; aisle ends on one front or back line are chained so the graph has cross
// aisles both ends; an aisle's start → end is its corridor. Shelf blocks either side of each aisle (one
// side when tagged), as wide as half the gap to the next parallel aisle allows; a block a walked leg
// crosses is left out (Validate would flag it) and reported. The categories each aisle's sign named
// become its shelf locations, spread along it, left and right in turn. Pins become nodes (Checkout lane →
// a checkout, Exit → the exit, departments → their label's anchor on the flat map). No exit pin: the
// entrance is the exit; no checkout pin: the entrance is the lane, and the report says so.

import type { Category, Department, Fixture, GraphEdge, GraphNode, NodeType, ShelfLocation, SignGroupMatch, SignMatch, StoreGraph } from "@grosher/core";
import { segmentOverlapsPolygon } from "@grosher/stores";
import type { Draft } from "../editor/model.ts";
import { aisleOfPhoto, type PinLabel, type Survey, type SurveyEvent } from "./model.ts";
import { angleDiff, circularMean } from "./steps.ts";

export const SNAP_DEG = 30;
export const DEFAULT_STRIDE_M = 0.7;
export const DEFAULT_PACE_MPS = 1.1;
/** half the walkway each side of an aisle's centre line; shelf blocks start beyond it */
export const HALF_AISLE_M = 0.9;
export const BLOCK_MAX_M = 1.2;
export const MERGE_M = 0.8;
/** aisle ends within this of one line (along the aisle's axis) are chained into a cross aisle */
export const LINE_TOL_M = 3;
export const BAY_M = 1.22;

export interface Pt {
  x: number;
  y: number;
}

export interface Leg {
  from: number;
  to: number;
  steps: number | null;
  durationMs: number;
  heading: number | null;
  /** degrees from the reference axis, after snapping */
  rel: number;
  snapped: boolean;
  metres: number;
  /** the event the leg ends at */
  eventId: string;
}

export interface DerivedAisle {
  id: string;
  index: number;
  code: string;
  head: Pt;
  tail: Pt;
  lengthM: number;
  steps: number | null;
  durationMs: number;
  heading: number | null;
  rel: number;
  /** the cross walk from the previous aisle's end, across the aisles (null for the first, or after a pin) */
  spacingM: number | null;
  endcap: boolean;
  oneSide: boolean;
  photos: string[];
  categories: SignMatch[];
  groups: SignGroupMatch[];
}

export interface DerivedPin {
  id: string;
  label: PinLabel;
  name?: string;
  at: Pt;
}

export interface Derived {
  strideM: number;
  paceMps: number;
  motion: boolean;
  entrance: Pt;
  legs: Leg[];
  aisles: DerivedAisle[];
  pins: DerivedPin[];
  /** every tap's point, by event id */
  points: Map<string, Pt>;
  walkedM: number;
  warnings: string[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function snap(rel: number, snapDeg: number): { rel: number; snapped: boolean } {
  const nearest = Math.round(rel / 90) * 90;
  return Math.abs(angleDiff(rel, nearest)) <= snapDeg ? { rel: ((nearest % 360) + 360) % 360, snapped: true } : { rel, snapped: false };
}

export function derive(s: Survey, opts: { strideM?: number; paceMps?: number; snapDeg?: number } = {}): Derived {
  const warnings: string[] = [];
  const strideM = opts.strideM ?? s.calibration?.strideM ?? DEFAULT_STRIDE_M;
  const paceMps = opts.paceMps ?? s.calibration?.paceMps ?? DEFAULT_PACE_MPS;
  if (!s.calibration) warnings.push(`Not calibrated: ${DEFAULT_STRIDE_M} m a step and ${DEFAULT_PACE_MPS} m/s assumed.`);
  const motion = s.motion && s.steps.length > 0;
  if (!motion) warnings.push(`No steps were counted: every leg is timed at ${paceMps.toFixed(2)} m/s.`);
  const ref = s.referenceHeading;
  if (ref === null) warnings.push("No compass: aisles drawn along the reference axis, every other walk across it.");
  const snapDeg = opts.snapDeg ?? SNAP_DEG;

  const points = new Map<string, Pt>();
  const legs: Leg[] = [];
  const aisles: DerivedAisle[] = [];
  const pins: DerivedPin[] = [];
  let p: Pt = { x: 0, y: 0 };
  let walkedM = 0;
  let prev: SurveyEvent | null = null;
  let lastCross: { leg: Leg; afterEnd: boolean } | null = null;
  const codes = new Set<string>();

  for (const e of s.events) {
    if (e.kind === "entrance") {
      points.set(e.id, { ...p });
      prev = e;
      continue;
    }
    if (!prev) continue; // nothing before the entrance counts
    const steps = motion ? s.steps.filter((t) => t >= prev!.t && t < e.t).length : null;
    const durationMs = Math.max(0, e.t - prev.t);
    const samples = s.headings.filter(([t]) => t >= prev!.t && t <= e.t).map(([, d]) => d);
    const heading = circularMean(samples);
    const inAisle = e.kind === "end";
    const raw = heading !== null && ref !== null ? angleDiff(heading, ref) : inAisle ? 0 : 90;
    const { rel, snapped } = snap(raw, snapDeg);
    const metres = steps !== null ? steps * strideM : (durationMs / 1000) * paceMps;
    const rad = (rel * Math.PI) / 180;
    const next = { x: p.x + metres * Math.sin(rad), y: p.y - metres * Math.cos(rad) };
    const leg: Leg = { from: prev.t, to: e.t, steps, durationMs, heading, rel: round2(rel), snapped, metres: round2(metres), eventId: e.id };
    legs.push(leg);
    walkedM += metres;
    p = next;
    points.set(e.id, { ...p });

    if (e.kind === "start") lastCross = { leg, afterEnd: prev.kind === "end" };
    if (e.kind === "end") {
      const start = s.events.find((x): x is Extract<SurveyEvent, { kind: "start" }> => x.kind === "start" && x.id === e.startId);
      if (start) {
        const photos = s.photos.filter((ph) => aisleOfPhoto(s, ph) === start.id);
        const cats = new Map<string, SignMatch>();
        const groups = new Map<string, SignGroupMatch>();
        let signNumber: string | undefined;
        for (const ph of photos) {
          if (ph.status !== "done" || !ph.reading) continue;
          signNumber ??= ph.reading.aisleNumber;
          for (const m of ph.reading.matches) if (!cats.has(m.categoryId) || cats.get(m.categoryId)!.confidence < m.confidence) cats.set(m.categoryId, m);
          for (const g of ph.reading.groups ?? []) if (!groups.has(g.group)) groups.set(g.group, g);
        }
        const number = start.number?.trim() || signNumber;
        let code = number ? (/^\d/.test(number) ? `A${number}` : number.toUpperCase()) : `A${aisles.length + 1}`;
        if (!number) warnings.push(`Aisle ${aisles.length + 1} of the walk has no number (no tag, none read off a sign): drawn as ${code}. Tag it, or rename it in the editor.`);
        while (codes.has(code)) code = `${code}b`;
        codes.add(code);
        // the spacing: the cross walk's component across this aisle
        let spacingM: number | null = null;
        if (lastCross?.afterEnd) spacingM = round2(Math.abs(lastCross.leg.metres * Math.sin(((lastCross.leg.rel - rel) * Math.PI) / 180)));
        aisles.push({
          id: start.id,
          index: aisles.length,
          code,
          head: points.get(start.id)!,
          tail: { ...p },
          lengthM: round2(metres),
          steps,
          durationMs,
          heading,
          rel: round2(rel),
          spacingM,
          endcap: !!start.endcap,
          oneSide: !!start.oneSide,
          photos: photos.map((ph) => ph.id),
          categories: [...cats.values()],
          groups: [...groups.values()],
        });
        if (!snapped) warnings.push(`${code} ran ${Math.round(raw)}° off the reference axis: not squared to the grid.`);
      }
    }
    if (e.kind === "pin") pins.push({ id: e.id, label: e.label, name: e.name, at: { ...p } });
    prev = e;
  }
  const open = s.events.at(-1)?.kind === "start";
  if (open) warnings.push("The last aisle has no End: it is left out.");
  return { strideM, paceMps, motion, entrance: { x: 0, y: 0 }, legs, aisles, pins, points, walkedM: round2(walkedM), warnings };
}

// ---------------------------------------------------------------- the draft

const PIN_DEPARTMENT: Partial<Record<PinLabel, string>> = { Produce: "produce", "Dairy wall": "dairy", Meat: "meat", Frozen: "frozen", Bakery: "bakery", Deli: "deli", Pharmacy: "pharmacy" };

export interface BuildReport {
  warnings: string[];
  aisles: number;
  categories: number;
  fixtures: number;
  droppedFixtures: number;
}

export function buildDraft(s: Survey, d: Derived, ref: { categories: Category[]; departments: Department[] }): { draft: Draft; report: BuildReport } {
  const warnings = [...d.warnings];
  // shift everything onto positive coordinates with a margin
  const all = [...d.points.values()];
  const margin = 6;
  const minX = Math.min(0, ...all.map((q) => q.x));
  const minY = Math.min(0, ...all.map((q) => q.y));
  const at = (q: Pt): Pt => ({ x: round2(q.x - minX + margin), y: round2(q.y - minY + margin) });

  // nodes: one per tap, merged when close
  const nodes: GraphNode[] = [];
  const nodeOf = new Map<string, string>();
  const place = (eventId: string, q: Pt, type: NodeType): string => {
    const pt = at(q);
    const near = nodes.find((n) => Math.hypot(n.x - pt.x, n.y - pt.y) <= MERGE_M);
    if (near) {
      // a door wins over a plain junction
      if (type !== "junction" && type !== "aisle_end" && (near.type === "junction" || near.type === "aisle_end")) near.type = type;
      nodeOf.set(eventId, near.id);
      return near.id;
    }
    const id = `n${nodes.length + 1}`;
    nodes.push({ id, ...pt, type });
    nodeOf.set(eventId, id);
    return id;
  };
  const pinType = (label: PinLabel): NodeType => (label === "Checkout lane" ? "checkout" : label === "Exit" ? "exit" : "junction");
  for (const e of s.events) {
    const q = d.points.get(e.id);
    if (!q) continue;
    place(e.id, q, e.kind === "entrance" ? "entrance" : e.kind === "pin" ? pinType(e.label) : "aisle_end");
  }

  // edges: the walk itself, then the cross aisles at both ends
  const edges: GraphEdge[] = [];
  const has = (a: string, b: string) => edges.some((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
  const addEdge = (a: string, b: string): string | null => {
    if (a === b) return null;
    const found = edges.find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
    if (found) return found.id;
    const id = `e${edges.length + 1}`;
    edges.push({ id, from: a, to: b });
    return id;
  };
  const walked = s.events.filter((e) => nodeOf.has(e.id));
  for (let i = 1; i < walked.length; i++) addEdge(nodeOf.get(walked[i - 1].id)!, nodeOf.get(walked[i].id)!);
  const aisleEdge = new Map<string, string>();
  for (const a of d.aisles) {
    const end = s.events.find((e) => e.kind === "end" && e.startId === a.id);
    const id = end && addEdge(nodeOf.get(a.id)!, nodeOf.get(end.id)!);
    if (id) aisleEdge.set(a.id, id);
  }
  // aisle ends on one line across the aisles: chain them, in order along the line
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const axis of [0, 90]) {
    const parallel = d.aisles.filter((a) => a.rel % 180 === axis % 180 && aisleEdge.has(a.id));
    const ends = parallel.flatMap((a) => {
      const e = edges.find((x) => x.id === aisleEdge.get(a.id))!;
      return [e.from, e.to];
    });
    const along = (n: GraphNode) => (axis === 0 ? n.y : n.x);
    const across = (n: GraphNode) => (axis === 0 ? n.x : n.y);
    const pool = [...new Set(ends)].map((id) => nodeById.get(id)!);
    const used = new Set<string>();
    for (const n of pool) {
      if (used.has(n.id)) continue;
      const line = pool.filter((m) => !used.has(m.id) && Math.abs(along(m) - along(n)) <= LINE_TOL_M).sort((a, b) => across(a) - across(b));
      line.forEach((m) => used.add(m.id));
      for (let i = 1; i < line.length; i++) if (!has(line[i - 1].id, line[i].id)) addEdge(line[i - 1].id, line[i].id);
    }
  }

  // doors
  const entranceId = nodeOf.get(s.events.find((e) => e.kind === "entrance")?.id ?? "") ?? nodes[0]?.id ?? "";
  const pinNode = (label: PinLabel) => d.pins.filter((p) => p.label === label).map((p) => nodeOf.get(p.id)!);
  const exitId = pinNode("Exit")[0] ?? entranceId;
  if (!pinNode("Exit").length) warnings.push("No Exit pin: the entrance is the exit.");
  let checkoutIds = [...new Set(pinNode("Checkout lane"))];
  if (!checkoutIds.length) {
    checkoutIds = [entranceId];
    warnings.push("No Checkout lane pin: the entrance stands in for the lanes.");
  }

  // shelf blocks, locations and categories per aisle
  const fixtures: Fixture[] = [];
  const locations: ShelfLocation[] = [];
  const categories: Category[] = [];
  const refById = new Map(ref.categories.map((c) => [c.id, c]));
  let dropped = 0;
  const segs = edges.map((e) => [nodeById.get(e.from)!, nodeById.get(e.to)!] as const);
  for (const a of d.aisles) {
    const head = at(a.head);
    const tail = at(a.tail);
    const len = Math.hypot(tail.x - head.x, tail.y - head.y);
    if (len < 1) continue;
    const u = { x: (tail.x - head.x) / len, y: (tail.y - head.y) / len };
    const left = { x: u.y, y: -u.x };
    const mid = { x: (head.x + tail.x) / 2, y: (head.y + tail.y) / 2 };
    const dept = a.categories.length ? majority(a.categories.map((c) => c.department)) : (a.groups[0]?.department ?? "dry");
    for (const side of a.oneSide ? [1] : [1, -1]) {
      // room to the next parallel aisle on this side
      let room = Infinity;
      for (const b of d.aisles) {
        if (b === a) continue;
        const bh = at(b.head);
        const bt = at(b.tail);
        const bl = Math.hypot(bt.x - bh.x, bt.y - bh.y) || 1;
        if (Math.abs(((bt.x - bh.x) * u.x + (bt.y - bh.y) * u.y) / bl) < 0.95) continue;
        const off = ((bh.x + bt.x) / 2 - mid.x) * left.x + ((bh.y + bt.y) / 2 - mid.y) * left.y;
        if (off * side > 0) room = Math.min(room, Math.abs(off));
      }
      const w = Math.min(BLOCK_MAX_M, room / 2 - HALF_AISLE_M);
      if (w < 0.3) continue;
      const n = { x: left.x * side, y: left.y * side };
      const inset = Math.min(0.5, len / 4);
      const a0 = { x: head.x + u.x * inset, y: head.y + u.y * inset };
      const a1 = { x: tail.x - u.x * inset, y: tail.y - u.y * inset };
      const poly: [number, number][] = [
        [a0.x + n.x * HALF_AISLE_M, a0.y + n.y * HALF_AISLE_M],
        [a1.x + n.x * HALF_AISLE_M, a1.y + n.y * HALF_AISLE_M],
        [a1.x + n.x * (HALF_AISLE_M + w), a1.y + n.y * (HALF_AISLE_M + w)],
        [a0.x + n.x * (HALF_AISLE_M + w), a0.y + n.y * (HALF_AISLE_M + w)],
      ].map(([x, y]) => [round2(x), round2(y)] as [number, number]);
      if (segs.some(([p, q]) => segmentOverlapsPolygon([p.x, p.y], [q.x, q.y], poly))) {
        dropped++;
        warnings.push(`The ${side === 1 ? "left" : "right"} shelf of ${a.code} is left out: a walked leg crosses it. Draw it in the editor.`);
        continue;
      }
      fixtures.push({ id: `f_${a.code}_${side === 1 ? "L" : "R"}`, kind: "shelf", polygon: poly, height: 1.8, department: dept, aisle: a.code, bays: Math.max(1, Math.round(len / BAY_M)) });
    }
    const edgeId = aisleEdge.get(a.id);
    if (!edgeId) continue;
    const forward = edges.find((e) => e.id === edgeId)!.from === nodeOf.get(a.id);
    const placed = a.categories.filter((c) => refById.has(c.categoryId));
    placed.forEach((m, k) => {
      const side: "L" | "R" = a.oneSide || k % 2 === 0 ? "L" : "R";
      const along = ((k + 0.5) / placed.length) * len;
      const bay = Math.max(1, Math.ceil(along / BAY_M));
      let id = `${a.code}-${side}${bay}`;
      while (locations.some((l) => l.id === id)) id += "x";
      locations.push({ id, aisle: a.code, side, bay: String(bay), zone: "GR", edgeId, offsetM: round2(forward ? along : len - along) });
      const c = refById.get(m.categoryId)!;
      categories.push({ ...c, aisle: a.code, side, bays: [bay, bay], locationId: id });
    });
    if (a.endcap) locations.push({ id: `${a.code}-E`, aisle: a.code, side: "E", bay: "100", zone: "GR", edgeId, offsetM: forward ? 0 : round2(len) });
  }

  // departments: the reference table, with each department pin as its label's anchor
  const departments = ref.departments.map((dep) => {
    const pin = d.pins.find((p) => PIN_DEPARTMENT[p.label] === dep.id);
    if (!pin) return { ...dep, anchor: undefined };
    const q = at(pin.at);
    return { ...dep, anchor: [q.x, q.y] as [number, number] };
  });

  const store: StoreGraph = { storeId: s.storeId, version: 1, name: s.name, address: s.address, nodes, edges, locations, entranceId, checkoutIds, exitId, fixtures, departments };
  return {
    draft: { store, catalog: [], categories },
    report: { warnings, aisles: d.aisles.length, categories: categories.length, fixtures: fixtures.length, droppedFixtures: dropped },
  };
}

function majority(xs: string[]): string {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0][0];
}
