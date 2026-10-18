// Grosher routing solver.
//
// Problem: open path from a fixed start (entrance or "where you are"),
// through every stop exactly once, ending at the best checkout lane, then
// the exit. Each stop may have several candidate shelf locations (generalized
// TSP). Real-world rules are penalty terms, so they trade off against
// distance instead of forcing backtracking.
//
// Every penalty depends only on (stop being added, set already visited),
// which keeps Held–Karp exact with penalties included.
//
//   n <= EXACT_LIMIT   exact Held–Karp DP over (visited set, last stop, candidate)
//   n >  EXACT_LIMIT   greedy construction + 2-opt + Or-opt, candidates chosen
//                      optimally for each order by a layered shortest path

import { WalkGraph } from "./graph.ts";
import { DEFAULT_WEIGHTS, isStorageTag, STORAGE_TAGS, type Route, type RouteLeg, type ShelfLocation, type Stop, type Weights } from "./types.ts";

export const EXACT_LIMIT = 13;

export interface SolveInput {
  stops: Stop[];
  /** node id to start from; defaults to the store entrance */
  fromNodeId?: string;
  weights?: Partial<Weights>;
  /** force a solver (benchmarks / tests) */
  mode?: "auto" | "exact" | "heuristic";
}

interface Prepared {
  n: number;
  stops: Stop[];
  cand: number[][]; // stop -> point indices of its candidate nodes
  pointNode: string[]; // point index -> node id (0 = start)
  pointLoc: (string | undefined)[];
  d: number[][]; // point -> point walking distance
  endCost: number[]; // point -> min over lanes (to lane + lane to exit)
  endLane: number[]; // index into checkoutIds achieving endCost
  penalty: (s: number, mask: number, pos: number) => number;
}

export class Router {
  readonly graph: WalkGraph;
  private sp = new Map<string, ReturnType<WalkGraph["dijkstra"]>>();

  constructor(graph: WalkGraph) {
    this.graph = graph;
  }

  /** Cached single-source shortest paths. The store graph is small, so this is cheap. */
  private from(nodeId: string) {
    let r = this.sp.get(nodeId);
    if (!r) {
      r = this.graph.dijkstra(nodeId);
      this.sp.set(nodeId, r);
    }
    return r;
  }

  dist(a: string, b: string): number {
    return this.from(a).dist.get(b) ?? Infinity;
  }

  /**
   * The stops this store can route: each keeps only the locations the map has; a stop left with none (a
   * location from an older map, a cached guess) is left out and reported, never thrown on.
   */
  placeable(stops: Stop[]): { stops: Stop[]; unplaced: Stop[] } {
    const out: Stop[] = [];
    const unplaced: Stop[] = [];
    for (const s of stops) {
      const known = s.locationIds.filter((l) => this.graph.locationNode.has(l));
      if (!known.length) unplaced.push(s);
      else out.push(this.storage(known.length === s.locationIds.length ? s : { ...s, locationIds: known }));
    }
    if (unplaced.length) console.warn(`[route] left out ${unplaced.length} stop(s) with no location on this map: ${unplaced.map((s) => `${s.id} (${s.locationIds.join(", ") || "none"})`).join("; ")}`);
    return { stops: out, unplaced };
  }

  /**
   * Cold is the shelf's storage: chilled / frozen come from the tags of the stop's first location (its
   * category's, in a generated or surveyed map), never from the item's words, its department or its aisle;
   * a location with no tags array says nothing and the stop keeps its own.
   */
  private storage(s: Stop): Stop {
    const loc = this.locById.get(s.locationIds[0]);
    if (!loc?.tags) return s;
    const cold = loc.tags.filter(isStorageTag);
    const tags = [...(s.tags ?? []).filter((t) => !isStorageTag(t)), ...cold];
    const same = tags.length === (s.tags ?? []).length && tags.every((t) => s.tags!.includes(t));
    return same ? s : { ...s, tags };
  }
  private _locById: Map<string, ShelfLocation> | null = null;
  private get locById(): Map<string, ShelfLocation> {
    return (this._locById ??= new Map(this.graph.store.locations.map((l) => [l.id, l])));
  }

  solve(input: SolveInput): Route {
    const t0 = performance.now();
    const store = this.graph.store;
    const start = input.fromNodeId ?? store.entranceId;
    const w: Weights = { ...DEFAULT_WEIGHTS, ...input.weights };
    const { stops, unplaced } = this.placeable(input.stops);
    const left = unplaced.map((s) => s.id);

    if (stops.length === 0) {
      const p = this.prepare(start, [], w);
      return { ...this.buildRoute(p, [], [], "empty", t0), unplaced: left };
    }

    const p = this.prepare(start, stops, w);
    const mode = input.mode ?? "auto";
    const exact = mode === "exact" || (mode === "auto" && stops.length <= EXACT_LIMIT);
    const { order, choice } = exact ? heldKarp(p) : heuristic(p);
    return { ...this.buildRoute(p, order, choice, exact ? "held-karp" : "heuristic", t0), unplaced: left };
  }

  /**
   * Evaluate a fixed visiting order (e.g. the order the list was typed in),
   * with the best candidate per stop. This is the honest baseline for the
   * "time saved" counter.
   */
  routeForOrder(stops: Stop[], fromNodeId?: string, weights?: Partial<Weights>): Route {
    const t0 = performance.now();
    const start = fromNodeId ?? this.graph.store.entranceId;
    const { stops: placed, unplaced } = this.placeable(stops);
    const p = this.prepare(start, placed, { ...DEFAULT_WEIGHTS, ...weights });
    const order = placed.map((_, i) => i);
    const { choice } = evaluateOrder(p, order);
    return { ...this.buildRoute(p, order, choice, "heuristic", t0), unplaced: unplaced.map((s) => s.id) };
  }

  /** Reroute = solve the remaining stops from where the shopper is now. */
  reroute(remaining: Stop[], currentNodeId: string, weights?: Partial<Weights>): Route {
    return this.solve({ stops: remaining, fromNodeId: currentNodeId, weights });
  }

  private prepare(start: string, stops: Stop[], w: Weights): Prepared {
    const g = this.graph;
    const pointNode = [start];
    const pointLoc: (string | undefined)[] = [undefined];
    const cand: number[][] = [];
    for (const s of stops) {
      if (!s.locationIds.length) throw new Error(`stop ${s.id} has no candidate locations`);
      const idxs: number[] = [];
      for (const locId of s.locationIds) {
        const node = g.locationNode.get(locId);
        if (!node) throw new Error(`stop ${s.id}: unknown location ${locId}`);
        idxs.push(pointNode.length);
        pointNode.push(node);
        pointLoc.push(locId);
      }
      cand.push(idxs);
    }

    const P = pointNode.length;
    const d = Array.from({ length: P }, (_, i) => {
      const { dist } = this.from(pointNode[i]);
      return pointNode.map((nd) => dist.get(nd) ?? Infinity);
    });

    const lanes = g.store.checkoutIds;
    const exit = g.store.exitId;
    const endCost: number[] = [];
    const endLane: number[] = [];
    for (let i = 0; i < P; i++) {
      let best = Infinity;
      let bl = 0;
      lanes.forEach((lane, li) => {
        const c = this.dist(pointNode[i], lane) + this.dist(lane, exit);
        if (c < best) {
          best = c;
          bl = li;
        }
      });
      endCost.push(best);
      endLane.push(bl);
    }

    // Tag masks for O(1) penalty evaluation inside the DP.
    const n = stops.length;
    const has = (s: Stop, ...t: string[]) => (s.tags ?? []).some((x) => t.includes(x));
    let coldMask = 0;
    let fragileMask = 0;
    stops.forEach((s, i) => {
      if (has(s, ...STORAGE_TAGS)) coldMask |= 1 << i;
      if (has(s, "fragile")) fragileMask |= 1 << i;
    });
    const isCold = stops.map((s) => has(s, ...STORAGE_TAGS));
    const isHeavy = stops.map((s) => has(s, "heavy"));
    const isFragile = stops.map((s) => has(s, "fragile"));
    const isProduce = stops.map((s) => has(s, "produce"));

    const penalty = (s: number, mask: number, pos: number): number => {
      let pen = 0;
      if (!isCold[s]) pen += w.coldLast * popcount(mask & coldMask);
      if (isHeavy[s]) pen += w.heavyEarly * pos;
      if (isFragile[s]) pen += w.fragileLate * (n - 1 - pos);
      if (isProduce[s]) pen += w.produceBeforeFragile * popcount(mask & fragileMask);
      return pen;
    };

    return { n, stops, cand, pointNode, pointLoc, d, endCost, endLane, penalty };
  }

  private buildRoute(
    p: Prepared,
    order: number[],
    choice: number[],
    solver: Route["solver"],
    t0: number,
  ): Route {
    const g = this.graph;
    const store = g.store;
    const legs: RouteLeg[] = [];
    let cur = 0;
    let mask = 0;
    let distanceM = 0;
    let penaltyM = 0;

    order.forEach((s, pos) => {
      const pt = choice[pos];
      const node = p.pointNode[pt];
      const leg = p.d[cur][pt];
      legs.push({
        stopId: p.stops[s].id,
        label: p.stops[s].name,
        nodeId: node,
        locationId: p.pointLoc[pt],
        path: WalkGraph.pathTo(this.from(p.pointNode[cur]).prev, p.pointNode[cur], node),
        distanceM: leg,
      });
      distanceM += leg;
      penaltyM += p.penalty(s, mask, pos);
      mask |= 1 << s;
      cur = pt;
    });

    const lane = store.checkoutIds[p.endLane[cur]];
    const curNode = p.pointNode[cur];
    const toLane = this.dist(curNode, lane);
    legs.push({
      stopId: null,
      label: "Checkout",
      nodeId: lane,
      path: WalkGraph.pathTo(this.from(curNode).prev, curNode, lane),
      distanceM: toLane,
    });
    const toExit = this.dist(lane, store.exitId);
    legs.push({
      stopId: null,
      label: "Exit",
      nodeId: store.exitId,
      path: WalkGraph.pathTo(this.from(lane).prev, lane, store.exitId),
      distanceM: toExit,
    });
    distanceM += toLane + toExit;

    return {
      legs,
      order: order.map((s) => p.stops[s].id),
      distanceM,
      penaltyM,
      costM: distanceM + penaltyM,
      solver,
      solveMs: performance.now() - t0,
    };
  }
}

// ---------------------------------------------------------------- exact

function heldKarp(p: Prepared): { order: number[]; choice: number[] } {
  const { n, cand, d, endCost, penalty } = p;
  if (n > 20) throw new Error("exact solver limited to 20 stops");

  // Flatten (stop, candidate point) pairs.
  const pairStop: number[] = [];
  const pairPt: number[] = [];
  cand.forEach((pts, s) =>
    pts.forEach((pt) => {
      pairStop.push(s);
      pairPt.push(pt);
    }),
  );
  const K = pairStop.length;
  const full = (1 << n) - 1;
  const size = (full + 1) * K;
  const dp = new Float64Array(size).fill(Infinity);
  const par = new Int32Array(size).fill(-1);

  for (let k = 0; k < K; k++) {
    const s = pairStop[k];
    dp[(1 << s) * K + k] = d[0][pairPt[k]] + penalty(s, 0, 0);
  }

  for (let mask = 1; mask <= full; mask++) {
    const pos = popcount(mask); // position index of the next stop
    for (let k = 0; k < K; k++) {
      const cur = dp[mask * K + k];
      if (cur === Infinity || !(mask & (1 << pairStop[k]))) continue;
      const from = pairPt[k];
      for (let k2 = 0; k2 < K; k2++) {
        const s2 = pairStop[k2];
        if (mask & (1 << s2)) continue;
        const nm = mask | (1 << s2);
        const v = cur + d[from][pairPt[k2]] + penalty(s2, mask, pos);
        const idx = nm * K + k2;
        if (v < dp[idx]) {
          dp[idx] = v;
          par[idx] = k;
        }
      }
    }
  }

  let best = Infinity;
  let bk = -1;
  for (let k = 0; k < K; k++) {
    const v = dp[full * K + k] + endCost[pairPt[k]];
    if (v < best) {
      best = v;
      bk = k;
    }
  }

  const order: number[] = [];
  const choice: number[] = [];
  let mask = full;
  let k = bk;
  while (k !== -1) {
    order.push(pairStop[k]);
    choice.push(pairPt[k]);
    const prev = par[mask * K + k];
    mask &= ~(1 << pairStop[k]);
    k = prev;
  }
  return { order: order.reverse(), choice: choice.reverse() };
}

// ------------------------------------------------------------ heuristic

/** For a fixed visiting order, pick the best candidate per stop (layered DP) and return total cost. */
function evaluateOrder(p: Prepared, order: number[]): { cost: number; choice: number[] } {
  const { d, cand, endCost, penalty } = p;
  let pen = 0;
  let mask = 0;
  order.forEach((s, pos) => {
    pen += penalty(s, mask, pos);
    mask |= 1 << s;
  });

  // Layered shortest path over candidates.
  let prevPts = [0];
  let prevCost = [0];
  const back: number[][] = [];
  for (const s of order) {
    const pts = cand[s];
    const cost = new Array(pts.length).fill(Infinity);
    const arg = new Array(pts.length).fill(0);
    pts.forEach((pt, j) => {
      prevPts.forEach((pp, i) => {
        const v = prevCost[i] + d[pp][pt];
        if (v < cost[j]) {
          cost[j] = v;
          arg[j] = i;
        }
      });
    });
    back.push(arg);
    prevPts = pts;
    prevCost = cost;
  }
  let best = Infinity;
  let bj = 0;
  prevPts.forEach((pt, j) => {
    const v = prevCost[j] + endCost[pt];
    if (v < best) {
      best = v;
      bj = j;
    }
  });
  const choice: number[] = new Array(order.length);
  for (let i = order.length - 1; i >= 0; i--) {
    choice[i] = cand[order[i]][bj];
    bj = back[i][bj];
  }
  return { cost: best + pen, choice };
}

/** Greedy construction: nearest next stop including its penalty. */
function greedyOrder(p: Prepared): number[] {
  const { n, cand, d, penalty } = p;
  const order: number[] = [];
  let mask = 0;
  let cur = 0;
  for (let pos = 0; pos < n; pos++) {
    let best = Infinity;
    let bs = -1;
    let bpt = -1;
    for (let s = 0; s < n; s++) {
      if (mask & (1 << s)) continue;
      for (const pt of cand[s]) {
        const v = d[cur][pt] + penalty(s, mask, pos);
        if (v < best) {
          best = v;
          bs = s;
          bpt = pt;
        }
      }
    }
    order.push(bs);
    mask |= 1 << bs;
    cur = bpt;
  }
  return order;
}

/** A seeded shuffle, so a restart is reproducible. */
function shuffled(n: number, seed: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  let x = seed | 0;
  for (let i = n - 1; i > 0; i--) {
    x = (Math.imul(x, 1103515245) + 12345) | 0;
    const j = ((x >>> 1) % (i + 1) + i + 1) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * How many starts the local search runs from: the greedy order, then seeded shuffles; the best result wins.
 * With delta evaluation a start costs a few ms. On the demo store the greedy start alone sits 16.8% over
 * exact at 12 stops, two starts 10.9%, three under 10% (the test's bar); four match the old four-restart
 * routes to the metre for ~8 ms more at 30 stops.
 */
export const HEURISTIC_RESTARTS = 3;

function heuristic(p: Prepared): { order: number[]; choice: number[] } {
  if (p.n > 31) throw new Error("heuristic currently supports up to 31 stops (bitmask penalties)");
  // Local search finds a local optimum; on a long store a greedy start can sit in a poor one. A few
  // restarts from shuffled orders cost milliseconds at these sizes and close most of the gap to exact.
  let best: { order: number[]; cost: number } | null = null;
  for (let r = 0; r < HEURISTIC_RESTARTS; r++) {
    const start = r === 0 ? greedyOrder(p) : shuffled(p.n, 7919 * (r + 1));
    const { order, cost } = localSearch(p, start);
    if (!best || cost < best.cost - 1e-9) best = { order, cost };
  }
  return { order: best!.order, choice: evaluateOrder(p, best!.order).choice };
}

/**
 * 2-opt + Or-opt from a given order, first improvement, until no move helps.
 *
 * Delta evaluation: with the candidate point of every stop fixed to the last
 * DP choice, a move is scored by the edges it changes (the two or three
 * boundary edges, plus the reversed interior for 2-opt, since walking
 * distances need not be symmetric) and by the penalties of the positions
 * whose preceding set or position changed: inside the reversed segment, or
 * between the removal and insertion points. Everything outside is unchanged.
 * An accepted move is followed by one layered DP over candidates (O(n·k²))
 * to re-pick points, which can only lower the cost further.
 */
function localSearch(p: Prepared, start: number[]): { order: number[]; cost: number } {
  const { n, d, endCost, penalty } = p;
  let order = [...start];
  let { cost, choice: pts } = evaluateOrder(p, order);
  // mask of the stops before each position, under the current order
  const maskBefore = (ord: number[]) => {
    const m = new Array<number>(ord.length + 1).fill(0);
    for (let k = 0; k < ord.length; k++) m[k + 1] = m[k] | (1 << ord[k]);
    return m;
  };
  let masks = maskBefore(order);
  const penAt = (ord: number[], mk: number[], k: number) => penalty(ord[k], mk[k], k);
  const pointBefore = (k: number) => (k === 0 ? 0 : pts[k - 1]);
  const edgeAfter = (k: number, from: number) => (k + 1 < n ? d[from][pts[k + 1]] : endCost[from]);

  const accept = (next: number[]) => {
    const e = evaluateOrder(p, next);
    order = next;
    cost = e.cost;
    pts = e.choice;
    masks = maskBefore(order);
  };

  let improved = true;
  while (improved) {
    improved = false;
    // 2-opt: reverse order[i..j]
    scan: for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pointBefore(i);
        // old boundary edges a→pts[i] and pts[j]→after; new a→pts[j] and pts[i]→after
        let delta = d[a][pts[j]] - d[a][pts[i]] + edgeAfter(j, pts[i]) - edgeAfter(j, pts[j]);
        // the interior walked the other way
        for (let k = i; k < j; k++) delta += d[pts[k + 1]][pts[k]] - d[pts[k]][pts[k + 1]];
        // penalties inside the segment: positions i..j see a different preceding set
        let mask = masks[i];
        for (let k = i; k <= j; k++) {
          const stop = order[j - (k - i)];
          delta += penalty(stop, mask, k) - penAt(order, masks, k);
          mask |= 1 << stop;
        }
        if (delta < -1e-9) {
          accept(order.slice(0, i).concat(order.slice(i, j + 1).reverse(), order.slice(j + 1)));
          improved = true;
          break scan;
        }
      }
    }
    if (improved) continue;
    // Or-opt: move the segment order[i..i+len) to sit before what is now rest[j]
    outer: for (let len = 1; len <= 3; len++) {
      for (let i = 0; i + len <= n; i++) {
        const segPts = pts.slice(i, i + len);
        const restPts = pts.slice(0, i).concat(pts.slice(i + len));
        const rest = order.slice(0, i).concat(order.slice(i + len));
        // removing the segment: a→seg0 … segLast→b becomes a→b
        const a = pointBefore(i);
        const bIdx = i + len; // position after the segment in the old order
        const removeGain = d[a][segPts[0]] + edgeAfter(bIdx - 1, segPts[len - 1]) - (bIdx < n ? d[a][pts[bIdx]] : endCost[a]);
        for (let j = 0; j <= rest.length; j++) {
          if (j === i) continue;
          // inserting between rest[j-1] (or the start) and rest[j] (or the end)
          const x = j === 0 ? 0 : restPts[j - 1];
          const yCost = (from: number) => (j < rest.length ? d[from][restPts[j]] : endCost[from]);
          const insertCost = d[x][segPts[0]] + yCost(segPts[len - 1]) - yCost(x);
          let delta = insertCost - removeGain;
          // penalties: positions from the first changed slot to the last shift or change their preceding set
          const next = rest.slice(0, j).concat(order.slice(i, i + len), rest.slice(j));
          const lo = Math.min(i, j);
          const hi = Math.max(i + len, j + len) - 1;
          let mask = masks[lo];
          for (let k = lo; k <= hi; k++) {
            delta += penalty(next[k], mask, k) - penAt(order, masks, k);
            mask |= 1 << next[k];
          }
          if (delta < -1e-9) {
            accept(next);
            improved = true;
            break outer;
          }
        }
      }
    }
  }
  return { order, cost };
}

function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
