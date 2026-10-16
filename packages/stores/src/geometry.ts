// Small 2D helpers for validating store data: polygons, segments, overlap.
// Shared by the stores tests and the editor's Validate.

import type { Fixture, StoreGraph } from "@grosher/core";

export type Pt = [number, number];

const EPS = 1e-9;

export function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function orient(a: Pt, b: Pt, c: Pt): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: Pt, b: Pt, p: Pt): boolean {
  return (
    Math.min(a[0], b[0]) - EPS <= p[0] && p[0] <= Math.max(a[0], b[0]) + EPS &&
    Math.min(a[1], b[1]) - EPS <= p[1] && p[1] <= Math.max(a[1], b[1]) + EPS
  );
}

/** Segments share at least one point (touching counts). */
export function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS)) && ((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS))) return true;
  if (Math.abs(o1) <= EPS && onSegment(a, b, c)) return true;
  if (Math.abs(o2) <= EPS && onSegment(a, b, d)) return true;
  if (Math.abs(o3) <= EPS && onSegment(c, d, a)) return true;
  if (Math.abs(o4) <= EPS && onSegment(c, d, b)) return true;
  return false;
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** At least three points, non-zero area, no two non-adjacent edges intersect. */
export function isSimplePolygon(poly: Pt[]): boolean {
  if (poly.length < 3) return false;
  if (Math.abs(polygonArea(poly)) < EPS) return false;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // adjacent edges share a vertex
      if (segmentsIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
    }
  }
  return true;
}

/** A corridor segment overlaps a fixture if it crosses or touches its outline, or has an endpoint inside it. */
export function segmentOverlapsPolygon(a: Pt, b: Pt, poly: Pt[]): boolean {
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return true;
  for (let i = 0; i < poly.length; i++) if (segmentsIntersect(a, b, poly[i], poly[(i + 1) % poly.length])) return true;
  return false;
}

/** Everything wrong with a store's fixtures, as human-readable lines. Empty = valid. */
export function fixtureProblems(store: StoreGraph): string[] {
  const out: string[] = [];
  const fixtures: Fixture[] = store.fixtures ?? [];
  const nodes = new Map(store.nodes.map((n) => [n.id, n]));
  const deptIds = new Set((store.departments ?? []).map((d) => d.id));
  const seen = new Set<string>();
  for (const f of fixtures) {
    if (seen.has(f.id)) out.push(`fixture ${f.id}: duplicate id`);
    seen.add(f.id);
    if (!isSimplePolygon(f.polygon)) out.push(`fixture ${f.id}: polygon is not a simple closed shape`);
    if (f.height !== undefined && !(f.height > 0)) out.push(`fixture ${f.id}: height must be positive`);
    if (f.department && store.departments && !deptIds.has(f.department)) out.push(`fixture ${f.id}: unknown department ${f.department}`);
    for (const e of store.edges) {
      const a = nodes.get(e.from);
      const b = nodes.get(e.to);
      if (!a || !b) continue;
      if (segmentOverlapsPolygon([a.x, a.y], [b.x, b.y], f.polygon)) out.push(`fixture ${f.id}: overlaps corridor edge ${e.id} (${e.from} → ${e.to})`);
    }
  }
  return out;
}
