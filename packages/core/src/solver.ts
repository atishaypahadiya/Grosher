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
import { DEFAULT_WEIGHTS, type Route, type RouteLeg, type Stop, type Weights } from "./types.ts";

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

  solve(input: SolveInput): Route {
    const t0 = performance.now();
    const store = this.graph.store;
    const start = input.fromNodeId ?? store.entranceId;
    const w: Weights = { ...DEFAULT_WEIGHTS, ...input.weights };
    const stops = input.stops;

    if (stops.length === 0) {
      const p = this.prepare(start, [], w);
      return this.buildRoute(p, [], [], "empty", t0);
    }

    const p = this.prepare(start, stops, w);
    const mode = input.mode ?? "auto";
    const exact = mode === "exact" || (mode === "auto" && stops.length <= EXACT_LIMIT);
    const { order, choice } = exact ? heldKarp(p) : heuristic(p);
    return this.buildRoute(p, order, choice, exact ? "held-karp" : "heuristic", t0);
  }

  /**
   * Evaluate a fixed visiting order (e.g. the order the list was typed in),
   * with the best candidate per stop. This is the honest baseline for the
   * "time saved" counter.
   */
  routeForOrder(stops: Stop[], fromNodeId?: string, weights?: Partial<Weights>): Route {
    const t0 = performance.now();
    const start = fromNodeId ?? this.graph.store.entranceId;
    const p = this.prepare(start, stops, { ...DEFAULT_WEIGHTS, ...weights });
    const order = stops.map((_, i) => i);
    const { choice } = evaluateOrder(p, order);
    return this.buildRoute(p, order, choice, "heuristic", t0);
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
      if (has(s, "frozen", "chilled")) coldMask |= 1 << i;
      if (has(s, "fragile")) fragileMask |= 1 << i;
    });
    const isCold = stops.map((s) => has(s, "frozen", "chilled"));
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

function heuristic(p: Prepared): { order: number[]; choice: number[] } {
  if (p.n > 31) throw new Error("heuristic currently supports up to 31 stops (bitmask penalties)");
  const { n, cand, d, penalty } = p;

  // Greedy construction: nearest next stop including its penalty.
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

  let bestCost = evaluateOrder(p, order).cost;
  let improved = true;
  while (improved) {
    improved = false;
    // 2-opt: reverse a segment.
    for (let i = 0; i < n - 1 && !improved; i++) {
      for (let j = i + 1; j < n; j++) {
        const cand2 = order.slice(0, i).concat(order.slice(i, j + 1).reverse(), order.slice(j + 1));
        const c = evaluateOrder(p, cand2).cost;
        if (c < bestCost - 1e-9) {
          order.splice(0, n, ...cand2);
          bestCost = c;
          improved = true;
          break;
        }
      }
    }
    if (improved) continue;
    // Or-opt: move a segment of length 1..3 elsewhere.
    outer: for (let len = 1; len <= 3; len++) {
      for (let i = 0; i + len <= n; i++) {
        const seg = order.slice(i, i + len);
        const rest = order.slice(0, i).concat(order.slice(i + len));
        for (let j = 0; j <= rest.length; j++) {
          if (j === i) continue;
          const cand2 = rest.slice(0, j).concat(seg, rest.slice(j));
          const c = evaluateOrder(p, cand2).cost;
          if (c < bestCost - 1e-9) {
            order.splice(0, n, ...cand2);
            bestCost = c;
            improved = true;
            break outer;
          }
        }
      }
    }
  }
  return { order, choice: evaluateOrder(p, order).choice };
}

function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
