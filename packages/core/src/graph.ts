// Store graph: builds the walkable graph, splits aisle edges at shelf
// locations (virtual nodes), and runs Dijkstra.

import type { GraphEdge, GraphNode, StoreGraph } from "./types.ts";

interface Arc {
  to: string;
  w: number;
}

export class WalkGraph {
  readonly nodes = new Map<string, GraphNode>();
  private adj = new Map<string, Arc[]>();
  /** shelf location id -> virtual node id */
  readonly locationNode = new Map<string, string>();

  readonly store: StoreGraph;

  constructor(store: StoreGraph) {
    this.store = store;
    for (const n of store.nodes) this.nodes.set(n.id, n);
    const edges = new Map<string, GraphEdge>(store.edges.map((e) => [e.id, e]));

    // Group shelf locations by edge so one edge can carry many virtual nodes.
    const byEdge = new Map<string, { locId: string; offset: number }[]>();
    for (const loc of store.locations) {
      if (!edges.has(loc.edgeId)) throw new Error(`location ${loc.id}: unknown edge ${loc.edgeId}`);
      const list = byEdge.get(loc.edgeId) ?? [];
      list.push({ locId: loc.id, offset: loc.offsetM });
      byEdge.set(loc.edgeId, list);
    }

    for (const e of store.edges) {
      const a = this.node(e.from);
      const b = this.node(e.to);
      const len = e.lengthM ?? Math.hypot(b.x - a.x, b.y - a.y);
      const locs = (byEdge.get(e.id) ?? []).sort((p, q) => p.offset - q.offset);

      // Chain: from -> loc1 -> loc2 -> ... -> to
      let prev = a.id;
      let prevOff = 0;
      for (const { locId, offset } of locs) {
        const off = Math.min(Math.max(offset, 0), len);
        const t = len === 0 ? 0 : off / len;
        const vid = `loc:${locId}`;
        if (!this.nodes.has(vid)) {
          this.nodes.set(vid, {
            id: vid,
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            type: "location",
          });
          this.link(prev, vid, off - prevOff, e.oneWay);
          prev = vid;
          prevOff = off;
        }
        this.locationNode.set(locId, vid);
      }
      this.link(prev, b.id, len - prevOff, e.oneWay);
    }
  }

  private node(id: string): GraphNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`unknown node ${id}`);
    return n;
  }

  private link(u: string, v: string, w: number, oneWay?: boolean) {
    if (!this.adj.has(u)) this.adj.set(u, []);
    if (!this.adj.has(v)) this.adj.set(v, []);
    this.adj.get(u)!.push({ to: v, w });
    if (!oneWay) this.adj.get(v)!.push({ to: u, w });
  }

  /** Single-source Dijkstra with a binary heap. Returns distances and predecessor map. */
  dijkstra(source: string): { dist: Map<string, number>; prev: Map<string, string> } {
    const dist = new Map<string, number>([[source, 0]]);
    const prev = new Map<string, string>();
    const heap = new MinHeap();
    heap.push(0, source);
    while (heap.size) {
      const [d, u] = heap.pop()!;
      if (d > (dist.get(u) ?? Infinity)) continue;
      for (const { to, w } of this.adj.get(u) ?? []) {
        const nd = d + w;
        if (nd < (dist.get(to) ?? Infinity)) {
          dist.set(to, nd);
          prev.set(to, u);
          heap.push(nd, to);
        }
      }
    }
    return { dist, prev };
  }

  static pathTo(prev: Map<string, string>, source: string, target: string): string[] {
    const path = [target];
    let cur = target;
    while (cur !== source) {
      const p = prev.get(cur);
      if (p === undefined) return [];
      path.push(p);
      cur = p;
    }
    return path.reverse();
  }
}

class MinHeap {
  private k: number[] = [];
  private v: string[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: string) {
    this.k.push(key);
    this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= this.k[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, string] | undefined {
    if (!this.k.length) return undefined;
    const top: [number, string] = [this.k[0], this.v[0]];
    const lk = this.k.pop()!;
    const lv = this.v.pop()!;
    if (this.k.length) {
      this.k[0] = lk;
      this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.k.length && this.k[l] < this.k[m]) m = l;
        if (r < this.k.length && this.k[r] < this.k[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.k[a], this.k[b]] = [this.k[b], this.k[a]];
    [this.v[a], this.v[b]] = [this.v[b], this.v[a]];
  }
}
