// Editor model: a draft store + catalog, pure operations on it, hit-testing,
// and validation. No React here, so every tool is unit-testable.

import { WalkGraph, Router, type Fixture, type GraphEdge, type GraphNode, type NodeType, type ShelfLocation, type Stop, type StoreGraph } from "@grosher/core";
import { fixtureProblems, pointInPolygon, type Pt as GeoPt } from "@grosher/stores";

export interface Pt {
  x: number;
  y: number;
}

export interface Draft {
  store: StoreGraph;
  catalog: Stop[];
}

export type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | { kind: "fixture"; id: string }
  | { kind: "location"; id: string }
  | null;

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 7)}`;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const round = (v: number) => Math.round(v * 10) / 10;

export function cloneDraft(d: Draft): Draft {
  return JSON.parse(JSON.stringify(d)) as Draft;
}

// ---------------------------------------------------------------- hit tests

export function nearestNode(store: StoreGraph, pt: Pt, within: number): GraphNode | undefined {
  let best: GraphNode | undefined;
  let bd = within;
  for (const n of store.nodes) {
    const d = dist(n, pt);
    if (d <= bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

/** Closest point on an edge: offset from edge.from in metres and the distance from pt. */
export function projectOnEdge(store: StoreGraph, edge: GraphEdge, pt: Pt): { offsetM: number; d: number; point: Pt } | undefined {
  const a = store.nodes.find((n) => n.id === edge.from);
  const b = store.nodes.find((n) => n.id === edge.to);
  if (!a || !b) return undefined;
  const len = dist(a, b);
  if (len === 0) return { offsetM: 0, d: dist(a, pt), point: { x: a.x, y: a.y } };
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * (b.x - a.x) + (pt.y - a.y) * (b.y - a.y)) / (len * len)));
  const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  return { offsetM: round(t * len), d: dist(point, pt), point };
}

export function nearestEdge(store: StoreGraph, pt: Pt, within: number): { edge: GraphEdge; offsetM: number; point: Pt } | undefined {
  let best: { edge: GraphEdge; offsetM: number; point: Pt } | undefined;
  let bd = within;
  for (const e of store.edges) {
    const p = projectOnEdge(store, e, pt);
    if (p && p.d <= bd) {
      bd = p.d;
      best = { edge: e, offsetM: p.offsetM, point: p.point };
    }
  }
  return best;
}

export function locationPoint(store: StoreGraph, loc: ShelfLocation): Pt | undefined {
  const e = store.edges.find((x) => x.id === loc.edgeId);
  const a = e && store.nodes.find((n) => n.id === e.from);
  const b = e && store.nodes.find((n) => n.id === e.to);
  if (!a || !b) return undefined;
  const len = dist(a, b) || 1;
  const t = Math.max(0, Math.min(1, loc.offsetM / len));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function nearestLocation(store: StoreGraph, pt: Pt, within: number): ShelfLocation | undefined {
  let best: ShelfLocation | undefined;
  let bd = within;
  for (const l of store.locations) {
    const p = locationPoint(store, l);
    if (!p) continue;
    const d = dist(p, pt);
    if (d <= bd) {
      bd = d;
      best = l;
    }
  }
  return best;
}

export function fixtureAt(store: StoreGraph, pt: Pt): Fixture | undefined {
  return (store.fixtures ?? []).find((f) => pointInPolygon([pt.x, pt.y], f.polygon as GeoPt[]));
}

/** What a tap selects, in priority order: node, location, edge, fixture. Radii in metres. */
export function pick(store: StoreGraph, pt: Pt, radiusM: number): Selection {
  const n = nearestNode(store, pt, radiusM);
  if (n) return { kind: "node", id: n.id };
  const l = nearestLocation(store, pt, radiusM);
  if (l) return { kind: "location", id: l.id };
  const e = nearestEdge(store, pt, radiusM * 0.8);
  if (e) return { kind: "edge", id: e.edge.id };
  const f = fixtureAt(store, pt);
  if (f) return { kind: "fixture", id: f.id };
  return null;
}

// ---------------------------------------------------------------- operations (each returns a new draft)

export function addNode(d: Draft, pt: Pt, type: NodeType = "junction", snapM = 0.8): { draft: Draft; id: string } {
  const existing = nearestNode(d.store, pt, snapM);
  if (existing) return { draft: d, id: existing.id };
  const id = uid("n");
  const node: GraphNode = { id, x: round(pt.x), y: round(pt.y), type };
  return { draft: { ...d, store: { ...d.store, nodes: [...d.store.nodes, node] } }, id };
}

export function addEdge(d: Draft, from: string, to: string, oneWay = false): { draft: Draft; id: string } {
  if (from === to) return { draft: d, id: "" };
  const dup = d.store.edges.find((e) => (e.from === from && e.to === to) || (!e.oneWay && e.from === to && e.to === from));
  if (dup) return { draft: d, id: dup.id };
  const id = uid("e");
  const edge: GraphEdge = oneWay ? { id, from, to, oneWay: true } : { id, from, to };
  return { draft: { ...d, store: { ...d.store, edges: [...d.store.edges, edge] } }, id };
}

export function updateEdge(d: Draft, id: string, patch: Partial<GraphEdge>): Draft {
  return { ...d, store: { ...d.store, edges: d.store.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) } };
}

export function reverseEdge(d: Draft, id: string): Draft {
  return { ...d, store: { ...d.store, edges: d.store.edges.map((e) => (e.id === id ? { ...e, from: e.to, to: e.from } : e)) } };
}

export function deleteEdge(d: Draft, id: string): Draft {
  const dropped = new Set(d.store.locations.filter((l) => l.edgeId === id).map((l) => l.id));
  return {
    store: { ...d.store, edges: d.store.edges.filter((e) => e.id !== id), locations: d.store.locations.filter((l) => l.edgeId !== id) },
    catalog: stripLocations(d.catalog, dropped),
  };
}

export function deleteNode(d: Draft, id: string): Draft {
  let out = d;
  for (const e of d.store.edges.filter((e) => e.from === id || e.to === id)) out = deleteEdge(out, e.id);
  const store = { ...out.store, nodes: out.store.nodes.filter((n) => n.id !== id) };
  if (store.entranceId === id) store.entranceId = "";
  if (store.exitId === id) store.exitId = "";
  store.checkoutIds = store.checkoutIds.filter((c) => c !== id);
  return { ...out, store };
}

export function updateNode(d: Draft, id: string, patch: Partial<GraphNode>): Draft {
  return { ...d, store: { ...d.store, nodes: d.store.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) } };
}

export type Door = "entrance" | "exit" | "checkout";

/** Mark a node as the entrance, the exit, or toggle it as a checkout lane. */
export function setDoor(d: Draft, nodeId: string, door: Door): Draft {
  const store = { ...d.store };
  const retype = (id: string, type: NodeType) => (store.nodes = store.nodes.map((n) => (n.id === id ? { ...n, type } : n)));
  if (door === "entrance") {
    if (store.entranceId && store.entranceId !== nodeId) retype(store.entranceId, "junction");
    store.entranceId = nodeId;
    retype(nodeId, "entrance");
  } else if (door === "exit") {
    if (store.exitId && store.exitId !== nodeId) retype(store.exitId, "junction");
    store.exitId = nodeId;
    retype(nodeId, "exit");
  } else {
    const on = store.checkoutIds.includes(nodeId);
    store.checkoutIds = on ? store.checkoutIds.filter((c) => c !== nodeId) : [...store.checkoutIds, nodeId];
    retype(nodeId, on ? "junction" : "checkout");
  }
  return { ...d, store };
}

export interface FixtureOptions {
  kind?: Fixture["kind"];
  department?: string;
  height?: number;
  aisle?: string;
}

/** Two opposite corners → an axis-aligned fixture. */
export function addFixtureRect(d: Draft, a: Pt, b: Pt, opts: FixtureOptions = {}): { draft: Draft; id: string } {
  const x0 = round(Math.min(a.x, b.x));
  const x1 = round(Math.max(a.x, b.x));
  const y0 = round(Math.min(a.y, b.y));
  const y1 = round(Math.max(a.y, b.y));
  if (x1 - x0 < 0.2 || y1 - y0 < 0.2) return { draft: d, id: "" };
  const id = uid("f");
  const f: Fixture = {
    id,
    kind: opts.kind ?? "shelf",
    polygon: [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    ...(opts.height !== undefined ? { height: opts.height } : {}),
    ...(opts.department ? { department: opts.department } : {}),
    ...(opts.aisle ? { aisle: opts.aisle } : {}),
  };
  return { draft: { ...d, store: { ...d.store, fixtures: [...(d.store.fixtures ?? []), f] } }, id };
}

export function updateFixture(d: Draft, id: string, patch: Partial<Fixture>): Draft {
  return { ...d, store: { ...d.store, fixtures: (d.store.fixtures ?? []).map((f) => (f.id === id ? { ...f, ...patch } : f)) } };
}

export function deleteFixture(d: Draft, id: string): Draft {
  return { ...d, store: { ...d.store, fixtures: (d.store.fixtures ?? []).filter((f) => f.id !== id) } };
}

export function addLocation(d: Draft, edgeId: string, offsetM: number, patch: Partial<ShelfLocation> = {}): { draft: Draft; id: string } {
  const id = uid("loc");
  // Default aisle: what the other locations on this corridor say, else the nearest labelled fixture.
  const pt = locationPoint(d.store, { id, aisle: "", edgeId, offsetM });
  let aisle = patch.aisle ?? "";
  if (!aisle) {
    const counts = new Map<string, number>();
    for (const l of d.store.locations) if (l.edgeId === edgeId && l.aisle) counts.set(l.aisle, (counts.get(l.aisle) ?? 0) + 1);
    aisle = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }
  if (!aisle && pt) {
    let bd = 3;
    for (const f of d.store.fixtures ?? []) {
      if (!f.aisle) continue;
      const xs = f.polygon.map((p) => p[0]);
      const ys = f.polygon.map((p) => p[1]);
      const dx = Math.max(Math.min(...xs) - pt.x, 0, pt.x - Math.max(...xs));
      const dy = Math.max(Math.min(...ys) - pt.y, 0, pt.y - Math.max(...ys));
      const dd = Math.hypot(dx, dy);
      if (dd < bd) {
        bd = dd;
        aisle = f.aisle;
      }
    }
  }
  const loc: ShelfLocation = { id, aisle, edgeId, offsetM: round(offsetM), side: "L", ...patch };
  return { draft: { ...d, store: { ...d.store, locations: [...d.store.locations, loc] } }, id };
}

export function updateLocation(d: Draft, id: string, patch: Partial<ShelfLocation>): Draft {
  return { ...d, store: { ...d.store, locations: d.store.locations.map((l) => (l.id === id ? { ...l, ...patch } : l)) } };
}

export function deleteLocation(d: Draft, id: string): Draft {
  return { store: { ...d.store, locations: d.store.locations.filter((l) => l.id !== id) }, catalog: stripLocations(d.catalog, new Set([id])) };
}

function stripLocations(catalog: Stop[], ids: Set<string>): Stop[] {
  return catalog.map((s) => ({ ...s, locationIds: s.locationIds.filter((l) => !ids.has(l)) })).filter((s) => s.locationIds.length > 0);
}

/** Items whose candidate shelves include this location. */
export function itemsAt(catalog: Stop[], locationId: string): Stop[] {
  return catalog.filter((s) => s.locationIds.includes(locationId));
}

/** Put an item on a shelf: an existing catalog item gains the location; a new name becomes a new item. */
export function addItemAt(d: Draft, locationId: string, name: string): Draft {
  const key = name.trim().toLowerCase();
  if (!key) return d;
  const loc = d.store.locations.find((l) => l.id === locationId);
  const existing = d.catalog.find((s) => s.id.toLowerCase() === key || s.name.toLowerCase() === key);
  if (existing) {
    if (existing.locationIds.includes(locationId)) return d;
    return { ...d, catalog: d.catalog.map((s) => (s === existing ? { ...s, locationIds: [...s.locationIds, locationId] } : s)) };
  }
  const id = key.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || uid("item");
  const stop: Stop = { id, name: name.trim(), locationIds: [locationId], confidence: 0.6, ...(loc?.tags?.length ? { tags: loc.tags } : {}) };
  return { ...d, catalog: [...d.catalog, stop] };
}

export function removeItemFrom(d: Draft, locationId: string, stopId: string): Draft {
  return { ...d, catalog: d.catalog.map((s) => (s.id === stopId ? { ...s, locationIds: s.locationIds.filter((l) => l !== locationId) } : s)).filter((s) => s.locationIds.length > 0) };
}

export function setDepartmentTexture(d: Draft, deptId: string, file: string): Draft {
  return { ...d, store: { ...d.store, departments: (d.store.departments ?? []).map((x) => (x.id === deptId ? { ...x, texture: file } : x)) } };
}

// ---------------------------------------------------------------- validation

export interface Issue {
  level: "error" | "warning";
  text: string;
}

export function validateDraft(d: Draft): Issue[] {
  const issues: Issue[] = [];
  const { store } = d;
  const nodeIds = new Set(store.nodes.map((n) => n.id));
  if (!store.entranceId || !nodeIds.has(store.entranceId)) issues.push({ level: "error", text: "No entrance node. Use the doors tool on a node." });
  if (!store.exitId || !nodeIds.has(store.exitId)) issues.push({ level: "error", text: "No exit node." });
  if (store.checkoutIds.length === 0) issues.push({ level: "error", text: "No checkout lane." });
  for (const e of store.edges) if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) issues.push({ level: "error", text: `Edge ${e.id} points at a missing node.` });
  for (const f of store.fixtures ?? []) if (!f.department) issues.push({ level: "warning", text: `Fixture ${f.id}${f.aisle ? ` (${f.aisle})` : ""} has no department.` });
  for (const p of fixtureProblems(store)) issues.push({ level: "error", text: p });
  const locIds = new Set(store.locations.map((l) => l.id));
  for (const s of d.catalog) for (const l of s.locationIds) if (!locIds.has(l)) issues.push({ level: "error", text: `${s.name}: unknown location ${l}.` });
  for (const l of store.locations) if (!l.aisle) issues.push({ level: "warning", text: `Location ${l.id} has no aisle code.` });

  if (issues.some((i) => i.level === "error")) return issues;
  try {
    const g = new WalkGraph(store);
    const router = new Router(g);
    const fromEntrance = g.dijkstra(store.entranceId).dist;
    for (const [loc, node] of g.locationNode) {
      if (!Number.isFinite(fromEntrance.get(node))) issues.push({ level: "error", text: `Location ${loc} cannot be reached from the entrance.` });
      else if (!Number.isFinite(router.dist(node, store.exitId))) issues.push({ level: "error", text: `No way out from location ${loc}.` });
    }
    for (const lane of store.checkoutIds) {
      if (!Number.isFinite(fromEntrance.get(lane))) issues.push({ level: "error", text: `Checkout ${lane} cannot be reached.` });
      else if (!Number.isFinite(router.dist(lane, store.exitId))) issues.push({ level: "error", text: `Checkout ${lane} does not reach the exit.` });
    }
    for (const n of store.nodes) if (!Number.isFinite(fromEntrance.get(n.id)) && n.id !== store.entranceId) issues.push({ level: "warning", text: `Node ${n.id} is not connected to the entrance.` });
  } catch (e) {
    issues.push({ level: "error", text: `Graph error: ${(e as Error).message}` });
  }
  return issues;
}

export function stats(d: Draft) {
  const unreachable = validateDraft(d).filter((i) => /cannot be reached|No way out/.test(i.text)).length;
  return {
    nodes: d.store.nodes.length,
    edges: d.store.edges.length,
    locations: d.store.locations.length,
    fixtures: (d.store.fixtures ?? []).length,
    textures: (d.store.departments ?? []).filter((x) => x.texture).length,
    items: d.catalog.length,
    unreachable,
  };
}
