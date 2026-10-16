// StoreMap: the flat map (DESIGN.md §4). SVG in floor-plan metres (y down):
// cream canvas with a dot grid, fixtures filled with their department color,
// the walk graph as soil hairlines, white route ribbon, lime for "now".
// Markers and hairlines are sized in screen pixels, so they do not scale
// with zoom. This is the editor renderer and the WebGL fallback.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { WalkGraph, type Fixture, type GraphNode, type Route, type StoreGraph } from "@grosher/core";

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pt {
  x: number;
  y: number;
}

/** Editor selection (§4): pinned edge, bay, location, node. */
export interface MapSelection {
  edgeId?: string;
  fixtureId?: string;
  locationId?: string;
  nodeId?: string;
}

export interface StoreMapProps {
  store: StoreGraph;
  route?: Route | null;
  /** node id of the next stop (lime point) */
  currentNodeId?: string | null;
  /** where the shopper is (lime dot with halo) */
  positionNodeId?: string | null;
  /** nodes walked so far; drawn as the walked segment of the ribbon */
  walkedPath?: string[];
  /** shelf nodes of collected stops; drawn as ring + check */
  doneNodeIds?: string[];
  selection?: MapSelection | null;
  /** editor: show the walk graph's nodes and one-way chevrons */
  showGraph?: boolean;
  /** editor layers */
  showFixtures?: boolean;
  showLocations?: boolean;
  /** fill fixtures with their department texture instead of the flat color */
  textureUrls?: Map<string, string>;
  repeatMeters?: number;
  /** a floor-plan image under everything, in metres */
  underlay?: { url: string; x: number; y: number; w: number; h: number; opacity: number } | null;
  /** tap on the map (not a drag), in map metres */
  onTap?: (pt: Pt) => void;
  /** pointer position in map metres, null when it leaves */
  onHover?: (pt: Pt | null) => void;
  /** current view box and map units per CSS pixel, for scale bars */
  onViewChange?: (view: ViewBox, unitsPerPx: number) => void;
  /** extra SVG in map coordinates, drawn on top */
  children?: ReactNode;
  className?: string;
}

const PAD = 4;
const MIN_W = 6;
const LIME = "#D4FF4A";
const SOIL = "#0F2A1A";
const SOIL_35 = "rgba(15,42,26,0.35)";
const SOIL_55 = "rgba(15,42,26,0.55)";
const AISLE = /^A\d+$/i;

export function boundsOf(nodes: Iterable<GraphNode>, pad = PAD): ViewBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x);
    y1 = Math.max(y1, n.y);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 10, h: 10 };
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

function fixtureBounds(f: Fixture): ViewBox {
  return boundsOf(f.polygon.map(([x, y]) => ({ id: "", x, y, type: "junction" as const })), 0);
}

function zoomAt(v: ViewBox, factor: number, at: Pt, maxW: number): ViewBox {
  const w = Math.min(Math.max(v.w / factor, MIN_W), maxW);
  const f = v.w / w;
  return { x: at.x - (at.x - v.x) / f, y: at.y - (at.y - v.y) / f, w, h: v.h / f };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

interface Gesture {
  view: ViewBox;
  moved: boolean;
  a: Pt;
  b?: Pt;
}

function pathPoints(ids: string[], nodes: Map<string, GraphNode>): Pt[] {
  const pts: Pt[] = [];
  let last: string | undefined;
  for (const id of ids) {
    if (id === last) continue;
    const n = nodes.get(id);
    if (n) pts.push({ x: n.x, y: n.y });
    last = id;
  }
  return pts;
}

const pointsAttr = (pts: Pt[]) => pts.map((p) => `${p.x},${p.y}`).join(" ");

/** Axis-aligned 4-point polygons draw as <rect> so they can carry a radius. */
function asRect(poly: [number, number][]): ViewBox | null {
  if (poly.length !== 4) return null;
  const xs = new Set(poly.map((p) => p[0]));
  const ys = new Set(poly.map((p) => p[1]));
  if (xs.size !== 2 || ys.size !== 2) return null;
  const [x0, x1] = [...xs].sort((a, b) => a - b);
  const [y0, y1] = [...ys].sort((a, b) => a - b);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function StoreMap({
  store,
  route,
  currentNodeId,
  positionNodeId,
  walkedPath,
  doneNodeIds,
  selection,
  showGraph,
  showFixtures = true,
  showLocations = true,
  textureUrls,
  repeatMeters = 2,
  underlay,
  onTap,
  onHover,
  onViewChange,
  children,
  className,
}: StoreMapProps) {
  const graph = useMemo(() => new WalkGraph(store), [store]);
  const nodes = graph.nodes;
  const initial = useMemo(() => {
    const all = [...nodes.values()];
    for (const f of store.fixtures ?? []) for (const [x, y] of f.polygon) all.push({ id: "", x, y, type: "junction" });
    return boundsOf(all);
  }, [nodes, store]);
  const maxW = initial.w * 3;

  const [view, setView] = useState<ViewBox>(initial);
  const [viewStore, setViewStore] = useState(store);
  if (viewStore !== store) {
    setViewStore(store);
    setView(initial);
  }
  const viewRef = useRef(view);
  viewRef.current = view;

  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<Gesture | null>(null);

  // Screen size, so markers can be specified in pixels.
  const [sizePx, setSizePx] = useState({ w: 390, h: 600 });
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      if (r.width && r.height) setSizePx({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  /** map units per CSS pixel (preserveAspectRatio meet) */
  const upp = Math.max(view.w / sizePx.w, view.h / sizePx.h);
  const px = (n: number) => n * upp;
  useEffect(() => {
    onViewChange?.(view, upp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.x, view.y, view.w, view.h, upp]);

  const unitsPerPx = (v: ViewBox) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return 1;
    return Math.max(v.w / r.width, v.h / r.height);
  };
  const clientToMap = (cx: number, cy: number, v: ViewBox): Pt => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return { x: v.x, y: v.y };
    const u = unitsPerPx(v);
    const ox = r.left + (r.width - v.w / u) / 2;
    const oy = r.top + (r.height - v.h / u) / 2;
    return { x: v.x + (cx - ox) * u, y: v.y + (cy - oy) * u };
  };
  const restartGesture = (moved: boolean) => {
    const ps = [...pointers.current.values()];
    gesture.current = ps.length ? { view: viewRef.current, moved, a: ps[0], b: ps[1] } : null;
  };
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    restartGesture(gesture.current?.moved ?? false);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (onHover && pointers.current.size === 0) onHover(clientToMap(e.clientX, e.clientY, viewRef.current));
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const ps = [...pointers.current.values()];
    if (ps.length === 1) {
      const dx = ps[0].x - g.a.x;
      const dy = ps[0].y - g.a.y;
      if (Math.hypot(dx, dy) > 4) g.moved = true;
      if (!g.moved) return;
      const u = unitsPerPx(g.view);
      setView({ ...g.view, x: g.view.x - dx * u, y: g.view.y - dy * u });
    } else if (g.b) {
      g.moved = true;
      const f = dist(ps[0], ps[1]) / Math.max(dist(g.a, g.b), 1);
      const m0 = mid(g.a, g.b);
      const m1 = mid(ps[0], ps[1]);
      let v = zoomAt(g.view, f, clientToMap(m0.x, m0.y, g.view), maxW);
      const u = unitsPerPx(v);
      v = { ...v, x: v.x - (m1.x - m0.x) * u, y: v.y - (m1.y - m0.y) * u };
      setView(v);
    }
  };
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    const tap = !!g && !g.moved && pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (tap && onTap) onTap(clientToMap(e.clientX, e.clientY, viewRef.current));
    restartGesture(true);
  };
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      setView(zoomAt(v, Math.exp(-e.deltaY * 0.0015), clientToMap(e.clientX, e.clientY, v), maxW));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxW]);

  // ---- derived drawing data
  const deptColor = useMemo(() => new Map((store.departments ?? []).map((d) => [d.id, d.color])), [store]);
  const fixtures = store.fixtures ?? [];
  const locs = useMemo(
    () =>
      store.locations.flatMap((loc) => {
        const nid = graph.locationNode.get(loc.id);
        const n = nid ? nodes.get(nid) : undefined;
        return n ? [{ loc, x: n.x, y: n.y, nodeId: nid! }] : [];
      }),
    [store, graph, nodes],
  );
  const fromEntrance = useMemo(() => graph.dijkstra(store.entranceId).dist, [graph, store]);

  // Labels: aisle codes at the aisle end nearest the entrance; department names along walls.
  const labels = useMemo(() => {
    const out: { key: string; text: string; x: number; y: number; rotate: number; kind: "aisle" | "wall" }[] = [];
    if (fixtures.length) {
      const seen = new Set<string>();
      // Aisle codes sit over the corridor (the aisle's shelf locations), not the shelf block.
      const corridor = new Map<string, Pt>();
      for (const l of locs) {
        const c = corridor.get(l.loc.aisle) ?? { x: 0, y: 0 };
        const n = locs.filter((o) => o.loc.aisle === l.loc.aisle).length;
        corridor.set(l.loc.aisle, { x: c.x + l.x / n, y: c.y + l.y / n });
      }
      for (const f of fixtures) {
        if (!f.aisle || seen.has(f.aisle)) continue;
        const b = fixtureBounds(f);
        const cor = corridor.get(f.aisle);
        const cx = AISLE.test(f.aisle) && cor ? cor.x : b.x + b.w / 2;
        const cy = AISLE.test(f.aisle) && cor ? cor.y : b.y + b.h / 2;
        if (AISLE.test(f.aisle)) {
          seen.add(f.aisle);
          // which end faces the entrance?
          const vertical = b.h >= b.w;
          const ends: Pt[] = vertical ? [{ x: cx, y: b.y }, { x: cx, y: b.y + b.h }] : [{ x: b.x, y: cy }, { x: b.x + b.w, y: cy }];
          const near = (p: Pt) => {
            let best = Infinity;
            for (const n of nodes.values()) {
              const d = fromEntrance.get(n.id);
              if (d !== undefined && dist(n, p) < 3) best = Math.min(best, d + dist(n, p));
            }
            return best;
          };
          const front = near(ends[0]) <= near(ends[1]) ? ends[0] : ends[1];
          const dir = front === ends[0] ? -1 : 1;
          out.push({ key: f.aisle, text: f.aisle, x: vertical ? cx : front.x + dir * 1.4, y: vertical ? front.y + dir * 1.6 : cy, rotate: 0, kind: "aisle" });
        } else if (f.kind === "wall") {
          seen.add(f.aisle);
          out.push({ key: f.aisle, text: f.aisle.toUpperCase(), x: cx, y: cy, rotate: b.h > b.w ? -90 : 0, kind: "wall" });
        }
      }
      return out;
    }
    // No fixtures yet (a map being drawn): label location groups at their entrance-side end.
    const groups = new Map<string, { pts: Pt[]; edges: Set<string> }>();
    for (const l of locs) {
      const g = groups.get(l.loc.aisle) ?? { pts: [], edges: new Set<string>() };
      g.pts.push(l);
      g.edges.add(l.loc.edgeId);
      groups.set(l.loc.aisle, g);
    }
    const edgeById = new Map(store.edges.map((e) => [e.id, e]));
    for (const [aisle, g] of groups) {
      const c = { x: g.pts.reduce((s, p) => s + p.x, 0) / g.pts.length, y: g.pts.reduce((s, p) => s + p.y, 0) / g.pts.length };
      let end: GraphNode | undefined;
      let best = Infinity;
      for (const eid of g.edges) {
        const e = edgeById.get(eid);
        for (const id of e ? [e.from, e.to] : []) {
          const d = fromEntrance.get(id) ?? Infinity;
          const n = nodes.get(id);
          if (n && d < best) {
            best = d;
            end = n;
          }
        }
      }
      if (!end) continue;
      const len = dist(c, end) || 1;
      out.push({ key: aisle, text: aisle, x: end.x + ((c.x - end.x) / len) * 1.6, y: end.y + ((c.y - end.y) / len) * 1.6, rotate: 0, kind: AISLE.test(aisle) ? "aisle" : "wall" });
    }
    return out;
  }, [fixtures, locs, nodes, fromEntrance, store]);

  // Route ribbon: walked / current / ahead.
  const walkedPts = useMemo(() => (walkedPath ? pathPoints(walkedPath, nodes) : []), [walkedPath, nodes]);
  const currentPts = useMemo(() => (route?.legs[0] ? pathPoints(route.legs[0].path, nodes) : []), [route, nodes]);
  const aheadPts = useMemo(() => (route ? pathPoints(route.legs.slice(1).flatMap((l) => l.path), nodes) : []), [route, nodes]);
  const stops = useMemo(
    () =>
      route
        ? route.legs
            .filter((l) => l.stopId !== null)
            .map((l, i) => ({ n: i + 1, node: nodes.get(l.nodeId), label: l.label }))
        : [],
    [route, nodes],
  );
  const lane = route?.legs.find((l) => l.label === "Checkout");
  const laneNode = lane ? nodes.get(lane.nodeId) : undefined;
  const current = currentNodeId ? nodes.get(currentNodeId) : undefined;
  const position = positionNodeId ? nodes.get(positionNodeId) : undefined;
  const entrance = nodes.get(store.entranceId);
  const exit = nodes.get(store.exitId);
  const done = (doneNodeIds ?? []).map((id) => nodes.get(id)).filter((n): n is GraphNode => !!n);

  const selEdge = selection?.edgeId ? store.edges.find((e) => e.id === selection.edgeId) : undefined;
  const selLoc = selection?.locationId ? locs.find((l) => l.loc.id === selection.locationId) : undefined;
  const selNode = selection?.nodeId ? nodes.get(selection.nodeId) : undefined;

  const hair = px(1);
  const font = (p: number) => px(p);

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      className={["store-map", className].filter(Boolean).join(" ")}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ touchAction: "none", userSelect: "none", fontFamily: "Outfit, system-ui, sans-serif" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => onHover?.(null)}
      role="img"
      aria-label={`Map of ${store.name ?? store.storeId}`}
    >
      <defs>
        <pattern id="map-dots" width={1} height={1} patternUnits="userSpaceOnUse">
          <circle cx={0.5} cy={0.5} r={px(0.8)} fill="var(--map-grid, rgba(15,42,26,0.12))" />
        </pattern>
        <filter id="map-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={px(3)} />
        </filter>
        {textureUrls &&
          [...textureUrls].map(([dept, url]) => (
            <pattern key={dept} id={`tex-${dept}`} width={repeatMeters} height={repeatMeters} patternUnits="userSpaceOnUse">
              <image href={url} width={repeatMeters} height={repeatMeters} preserveAspectRatio="none" />
            </pattern>
          ))}
      </defs>
      <rect x={initial.x - 100} y={initial.y - 100} width={initial.w + 200} height={initial.h + 200} fill="var(--map-canvas, #EDE9DB)" />
      <rect x={initial.x - 100} y={initial.y - 100} width={initial.w + 200} height={initial.h + 200} fill="url(#map-dots)" />
      {underlay && <image data-layer="underlay" href={underlay.url} x={underlay.x} y={underlay.y} width={underlay.w} height={underlay.h} opacity={underlay.opacity} preserveAspectRatio="none" />}

      {/* fixtures */}
      <g data-layer="fixtures" stroke={SOIL_35} strokeWidth={hair} strokeLinejoin="round" style={showFixtures ? undefined : { display: "none" }}>
        {fixtures.map((f) => {
          const tex = f.department && textureUrls?.get(f.department) ? `url(#tex-${f.department})` : null;
          const fill = tex ?? ((f.department && deptColor.get(f.department)) || "#DCE3D4");
          const selected = selection?.fixtureId === f.id;
          const r = asRect(f.polygon);
          const common = { "data-fixture": f.id, fill: selected ? "rgba(212,255,74,0.55)" : fill, stroke: selected ? SOIL : undefined, strokeWidth: selected ? px(1.5) : undefined };
          return r ? (
            <rect key={f.id} x={r.x} y={r.y} width={r.w} height={r.h} rx={px(2)} {...common} />
          ) : (
            <polygon key={f.id} points={pointsAttr(f.polygon.map(([x, y]) => ({ x, y })))} {...common} />
          );
        })}
      </g>

      {/* walk graph */}
      <g data-layer="edges" stroke={SOIL_35} strokeWidth={hair} strokeLinecap="round">
        {store.edges.map((e) => {
          const a = nodes.get(e.from);
          const b = nodes.get(e.to);
          if (!a || !b) return null;
          return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
      </g>
      {showGraph && (
        <g data-layer="graph-nodes">
          {store.edges.map((e) => {
            if (!e.oneWay) return null;
            const a = nodes.get(e.from);
            const b = nodes.get(e.to);
            if (!a || !b) return null;
            const m = mid(a, b);
            const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
            return <path key={e.id} d={`M${-px(4)},${-px(4)} L${px(3)},0 L${-px(4)},${px(4)}`} fill="none" stroke={SOIL_55} strokeWidth={hair} transform={`translate(${m.x} ${m.y}) rotate(${deg})`} />;
          })}
          {store.nodes.map((n) => (
            <circle key={n.id} cx={n.x} cy={n.y} r={px(3)} fill="#FFFFFF" stroke={SOIL_55} strokeWidth={hair} data-node={n.id} />
          ))}
        </g>
      )}

      {/* shelf locations */}
      <g data-layer="locations" fill={SOIL_55} style={showLocations ? undefined : { display: "none" }}>
        {locs.map((l) => (
          <circle key={l.loc.id} cx={l.x} cy={l.y} r={px(2)} data-location={l.loc.id} />
        ))}
      </g>

      {/* labels */}
      <g data-layer="labels" fill={SOIL_55} textAnchor="middle" fontWeight={500}>
        {labels.map((l) => (
          <text
            key={l.key}
            x={l.x}
            y={l.y}
            fontSize={font(l.kind === "aisle" ? 11 : 10)}
            letterSpacing={l.kind === "wall" ? px(2) : 0}
            dominantBaseline="middle"
            transform={l.rotate ? `rotate(${l.rotate} ${l.x} ${l.y})` : undefined}
            data-label={l.key}
          >
            {l.text}
          </text>
        ))}
      </g>

      {/* route ribbon */}
      {walkedPts.length > 1 && <polyline data-layer="route-walked" points={pointsAttr(walkedPts)} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={px(2)} strokeLinecap="round" strokeLinejoin="round" />}
      {currentPts.length > 1 && (
        <g data-layer="route">
          <polyline points={pointsAttr(currentPts)} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={px(5)} strokeLinecap="round" strokeLinejoin="round" filter="url(#map-glow)" />
          <polyline points={pointsAttr(currentPts)} fill="none" stroke="#FFFFFF" strokeWidth={px(2)} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {aheadPts.length > 1 && <polyline data-layer="route-ahead" points={pointsAttr(aheadPts)} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={px(2)} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${px(1)} ${px(6)}`} />}

      {/* selection (editor) */}
      {selEdge && nodes.get(selEdge.from) && nodes.get(selEdge.to) && (
        <line data-layer="selection-edge" x1={nodes.get(selEdge.from)!.x} y1={nodes.get(selEdge.from)!.y} x2={nodes.get(selEdge.to)!.x} y2={nodes.get(selEdge.to)!.y} stroke={SOIL} strokeWidth={px(2)} strokeLinecap="round" />
      )}
      {selNode && <circle cx={selNode.x} cy={selNode.y} r={px(5)} fill={LIME} stroke={SOIL} strokeWidth={hair} data-layer="selection-node" />}
      {selLoc && (
        <g data-layer="selection-location">
          <circle cx={selLoc.x} cy={selLoc.y} r={px(5)} fill={LIME} stroke={SOIL} strokeWidth={px(1.5)} />
          <text x={selLoc.x} y={selLoc.y - px(10)} fontSize={font(10)} textAnchor="middle" fill={SOIL}>
            offset {selLoc.loc.offsetM.toFixed(1)} m
          </text>
        </g>
      )}

      {/* markers: entrance, exit, done, ahead, lane, next, you */}
      {entrance && <circle cx={entrance.x} cy={entrance.y} r={px(6)} fill="none" stroke="#FFFFFF" strokeWidth={px(1.5)} data-landmark="entrance" />}
      {exit && <circle cx={exit.x} cy={exit.y} r={px(6)} fill="none" stroke={LIME} strokeWidth={px(1.5)} data-landmark="exit" />}
      <g data-layer="done">
        {done.map((n, i) => (
          <g key={`${n.id}-${i}`} transform={`translate(${n.x} ${n.y})`} data-done={n.id}>
            <circle r={px(6)} fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth={hair} />
            <path d={`M${-px(2.6)},${px(0.2)} L${-px(0.8)},${px(2)} L${px(2.8)},${-px(2.2)}`} fill="none" stroke="#FFFFFF" strokeWidth={px(1.3)} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ))}
      </g>
      <g data-layer="stops" fontWeight={600} textAnchor="middle">
        {stops.map((s, i) =>
          s.node && i > 0 ? (
            <g key={s.n} transform={`translate(${s.node.x} ${s.node.y})`} data-stop={s.n}>
              <circle r={px(6)} fill="#FFFFFF" />
              <text y={px(3.2)} fontSize={font(9)} fill={SOIL}>
                {s.n}
              </text>
            </g>
          ) : null,
        )}
      </g>
      {laneNode && <circle cx={laneNode.x} cy={laneNode.y} r={px(4)} fill={LIME} data-landmark="lane" />}
      {current && (
        <g data-landmark="current" data-stop={stops[0]?.n ?? 1}>
          <circle cx={current.x} cy={current.y} r={px(7)} fill="rgba(212,255,74,0.45)" filter="url(#map-glow)" />
          <circle cx={current.x} cy={current.y} r={px(4)} fill={LIME} stroke="#FFFFFF" strokeWidth={hair} />
        </g>
      )}
      {position && (
        <g data-landmark="you">
          <circle className="map-halo" cx={position.x} cy={position.y} r={px(14)} fill="rgba(212,255,74,0.35)" />
          <circle cx={position.x} cy={position.y} r={px(5.5)} fill={LIME} stroke="#FFFFFF" strokeWidth={hair} />
        </g>
      )}

      {children}
    </svg>
  );
}
