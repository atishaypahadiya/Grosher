// StoreMap: SVG rendering of a StoreGraph in floor-plan metres (y down),
// with pan, pinch zoom and wheel zoom. Everything inside the <svg> is in
// map units, so overlays passed as children can use node coordinates.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { WalkGraph, type GraphNode, type Route, type StoreGraph } from "@grosher/core";

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

export interface StoreMapProps {
  store: StoreGraph;
  route?: Route | null;
  /** node id to ring, e.g. the next stop in trip mode */
  currentNodeId?: string | null;
  /** where the shopper is (last checked-off node) */
  positionNodeId?: string | null;
  /** tap on the map (not a drag), in map metres */
  onTap?: (pt: Pt) => void;
  /** extra SVG in map coordinates, drawn above the route */
  children?: ReactNode;
  className?: string;
}

const PAD = 4;
const MIN_W = 6;

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

/** Route polyline through node coordinates, legs joined. */
function routePoints(route: Route, nodes: Map<string, GraphNode>): Pt[] {
  const pts: Pt[] = [];
  let last: string | undefined;
  for (const leg of route.legs) {
    for (const id of leg.path) {
      if (id === last) continue;
      const n = nodes.get(id);
      if (n) pts.push({ x: n.x, y: n.y });
      last = id;
    }
  }
  return pts;
}

export function StoreMap({ store, route, currentNodeId, positionNodeId, onTap, children, className }: StoreMapProps) {
  const graph = useMemo(() => new WalkGraph(store), [store]);
  const nodes = graph.nodes;
  const initial = useMemo(() => boundsOf(nodes.values()), [nodes]);
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

  /** map units per CSS pixel for a given view (preserveAspectRatio meet) */
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
      const f = Math.exp(-e.deltaY * 0.0015);
      setView(zoomAt(v, f, clientToMap(e.clientX, e.clientY, v), maxW));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxW]);

  // ---- derived drawing data
  const locs = useMemo(
    () =>
      store.locations.flatMap((loc) => {
        const nid = graph.locationNode.get(loc.id);
        const n = nid ? nodes.get(nid) : undefined;
        return n ? [{ loc, x: n.x, y: n.y }] : [];
      }),
    [store, graph, nodes],
  );
  const routePts = useMemo(() => (route ? routePoints(route, nodes) : []), [route, nodes]);
  const stops = useMemo(
    () =>
      route
        ? route.legs
            .filter((l) => l.stopId !== null)
            .map((l, i) => ({ n: i + 1, node: nodes.get(l.nodeId), label: l.label }))
        : [],
    [route, nodes],
  );
  // Aisle signs hang at the end of the aisle you approach from (nearest the
  // entrance by walking distance), 1.6 m in. A sign a stop marker overlaps
  // is dropped: stop numbers always win.
  const signs = useMemo(() => {
    const fromEntrance = graph.dijkstra(store.entranceId).dist;
    const edgeById = new Map(store.edges.map((e) => [e.id, e]));
    const groups = new Map<string, { pts: Pt[]; edges: Set<string> }>();
    for (const l of locs) {
      const g = groups.get(l.loc.aisle) ?? { pts: [], edges: new Set<string>() };
      g.pts.push(l);
      g.edges.add(l.loc.edgeId);
      groups.set(l.loc.aisle, g);
    }
    const out: { aisle: string; x: number; y: number; w: number }[] = [];
    for (const [aisle, g] of groups) {
      const c = { x: g.pts.reduce((s, p) => s + p.x, 0) / g.pts.length, y: g.pts.reduce((s, p) => s + p.y, 0) / g.pts.length };
      if (Math.max(...g.pts.map((p) => dist(p, c))) > 14) continue;
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
      const len = Math.hypot(c.x - end.x, c.y - end.y) || 1;
      const x = end.x + ((c.x - end.x) / len) * 1.6;
      const y = end.y + ((c.y - end.y) / len) * 1.6;
      const w = aisle.length * 0.7 + 1;
      const covered = stops.some((s) => s.node && Math.abs(s.node.x - x) < w / 2 + 1.3 && Math.abs(s.node.y - y) < 0.8 + 1.3);
      if (!covered) out.push({ aisle, x, y, w });
    }
    return out;
  }, [locs, graph, store, nodes, stops]);
  const checkouts = new Set(store.checkoutIds);
  const current = currentNodeId ? nodes.get(currentNodeId) : undefined;
  const position = positionNodeId ? nodes.get(positionNodeId) : undefined;

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      className={["store-map", className].filter(Boolean).join(" ")}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ touchAction: "none", userSelect: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="img"
      aria-label={`Map of ${store.storeId}`}
    >
      <rect x={initial.x - 50} y={initial.y - 50} width={initial.w + 100} height={initial.h + 100} fill="var(--map-floor, #EDE9DB)" />

      {/* walkable edges */}
      <g data-layer="edges" stroke="var(--map-walk, #D7DDD6)" strokeWidth={1.8} strokeLinecap="round">
        {store.edges.map((e) => {
          const a = nodes.get(e.from);
          const b = nodes.get(e.to);
          if (!a || !b) return null;
          return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
      </g>
      <g data-layer="one-way" fill="none" stroke="var(--map-ink-soft, #8A969C)" strokeWidth={0.25} strokeLinejoin="round">
        {store.edges.map((e) => {
          if (!e.oneWay) return null;
          const a = nodes.get(e.from);
          const b = nodes.get(e.to);
          if (!a || !b) return null;
          const m = mid(a, b);
          const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
          return <path key={e.id} d="M-0.5,-0.55 L0.35,0 L-0.5,0.55" transform={`translate(${m.x} ${m.y}) rotate(${deg})`} />;
        })}
      </g>

      {/* shelf locations */}
      <g data-layer="locations" fill="var(--map-ink, #2B3A42)">
        {locs.map((l) => (
          <circle key={l.loc.id} cx={l.x} cy={l.y} r={0.45} data-location={l.loc.id} />
        ))}
      </g>

      {/* route */}
      {routePts.length > 1 && (
        <g data-layer="route" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <polyline points={routePts.map((p) => `${p.x},${p.y}`).join(" ")} stroke="var(--map-floor, #EDE9DB)" strokeWidth={1.7} />
          <polyline points={routePts.map((p) => `${p.x},${p.y}`).join(" ")} stroke="var(--map-route, #FFFFFF)" strokeWidth={0.9} />
        </g>
      )}
      {/* entrance, exit, checkouts: above the route */}
      <g data-layer="landmarks">
        {store.nodes.map((n) => {
          if (checkouts.has(n.id))
            return <rect key={n.id} x={n.x - 0.7} y={n.y - 1.2} width={1.4} height={2.4} rx={0.3} fill="var(--map-checkout, #E8B23A)" data-landmark="checkout" />;
          if (n.id === store.entranceId)
            return <circle key={n.id} cx={n.x} cy={n.y} r={1.3} fill="var(--map-entrance, #1F7A4D)" data-landmark="entrance" />;
          if (n.id === store.exitId)
            return <circle key={n.id} cx={n.x} cy={n.y} r={1.3} fill="none" stroke="var(--map-ink, #2B3A42)" strokeWidth={0.4} data-landmark="exit" />;
          return null;
        })}
      </g>

      {/* aisle signs: above the route, below stop markers */}
      <g data-layer="signs" fontFamily="Barlow, system-ui, sans-serif" fontSize={1.1} fontWeight={600} textAnchor="middle">
        {signs.map((s) => (
          <g key={s.aisle} transform={`translate(${s.x} ${s.y})`} data-sign={s.aisle}>
            <rect x={-s.w / 2} y={-0.8} width={s.w} height={1.6} rx={0.3} fill="var(--map-sign, #2B3A42)" />
            <text y={0.4} fill="var(--map-sign-ink, #FFFFFF)">{s.aisle}</text>
          </g>
        ))}
      </g>

      {stops.length > 0 && (
        <g data-layer="stops" fontFamily="Barlow, system-ui, sans-serif" fontSize={1.4} fontWeight={600} textAnchor="middle">
          {stops.map((s) =>
            s.node ? (
              <g key={s.n} transform={`translate(${s.node.x} ${s.node.y})`} data-stop={s.n}>
                <circle r={1.3} fill="var(--map-floor, #EDE9DB)" stroke="var(--map-route, #FFFFFF)" strokeWidth={0.35} />
                <text y={0.5} fill="var(--map-route, #FFFFFF)">{s.n}</text>
              </g>
            ) : null,
          )}
        </g>
      )}
      {current && (
        <circle className="map-current" cx={current.x} cy={current.y} r={2.4} fill="none" stroke="var(--map-current, #F2A900)" strokeWidth={0.5} data-landmark="current" />
      )}

      {position && (
        <circle cx={position.x} cy={position.y} r={0.95} fill="var(--map-you, #1C2528)" stroke="var(--map-floor, #EDE9DB)" strokeWidth={0.35} data-landmark="you" />
      )}

      {children}
    </svg>
  );
}
