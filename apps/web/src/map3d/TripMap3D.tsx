// The 3D trip map: a demand-rendered R3F canvas plus touch gestures on its
// container. Everything about *what* to show is derived here from the trip.

import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Canvas } from "@react-three/fiber";
import { WalkGraph, type RouteLeg, type StoreGraph } from "@grosher/core";
import type { StoreBundle } from "@grosher/stores";
import type { TripState } from "../lib/trip.ts";
import { Scene } from "./Scene.tsx";
import type { CameraRigHandle } from "./CameraRig.tsx";
import { fixtureBox, fixtureForLocation } from "./layout.ts";
import { slotFor } from "@grosher/stores";
import type { Focus, SafeArea } from "./CameraRig.tsx";
import { OverlayDom, useOverlayItems, type NextLabel, type OverlayRegistry, type StopCard } from "./Overlay.tsx";
import { locationDepartment } from "../lib/chips.ts";

export interface TripMap3DProps {
  bundle: StoreBundle;
  trip: TripState;
  flat: boolean;
  onFlatChange: (flat: boolean) => void;
  nextLabel: NextLabel | null;
  checkoutLabel: { eyebrow: string; line: string } | null;
  perf?: boolean;
  className?: string;
  /** fractions of the map height covered by the header strip (top) and the bottom sheet (bottom) */
  safe?: SafeArea;
}

interface Pt {
  x: number;
  y: number;
}
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const angle = (a: Pt, b: Pt) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

export function footprintOf(store: StoreGraph) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const n of store.nodes) {
    x0 = Math.min(x0, n.x);
    x1 = Math.max(x1, n.x);
    y0 = Math.min(y0, n.y);
    y1 = Math.max(y1, n.y);
  }
  for (const [x, y] of store.outline ?? []) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  for (const f of store.fixtures ?? []) {
    const b = fixtureBox(f);
    x0 = Math.min(x0, b.cx - b.w / 2);
    x1 = Math.max(x1, b.cx + b.w / 2);
    y0 = Math.min(y0, b.cz - b.d / 2);
    y1 = Math.max(y1, b.cz + b.d / 2);
  }
  const pad = 2;
  return { x: (x0 + x1) / 2, z: (y0 + y1) / 2, w: x1 - x0 + 2 * pad, d: y1 - y0 + 2 * pad };
}

export default function TripMap3D({ bundle, trip, flat, onFlatChange, nextLabel, checkoutLabel, perf = false, className, safe = { top: 0.16, bottom: 0.36 } }: TripMap3DProps) {
  const { store } = bundle;
  const graph = useMemo(() => new WalkGraph(store), [store]);
  const nodes = graph.nodes;
  const fromEntrance = useMemo(() => graph.dijkstra(store.entranceId).dist, [graph, store]);
  const footprint = useMemo(() => footprintOf(store), [store]);
  const repeatMeters = Object.values(bundle.textures)[0]?.repeatMeters ?? 2;
  const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const legs = trip.route.legs;
  const current = legs[0];
  const nextIsStop = !!current?.stopId;
  const nextNode = current ? nodes.get(current.nodeId) : undefined;
  const litFixtureId = useMemo(() => (nextIsStop ? fixtureForLocation(store, current?.locationId, nextNode)?.id ?? null : null), [store, current, nextNode, nextIsStop]);
  const litSlot = useMemo(() => {
    if (!nextIsStop || !current?.locationId) return null;
    const loc = store.locations.find((l) => l.id === current.locationId);
    return loc ? slotFor(store, loc) ?? null : null;
  }, [store, current, nextIsStop]);
  const legFixtureIds = useMemo(() => {
    const pts = (current?.path ?? []).map((id) => nodes.get(id)).filter((n): n is NonNullable<typeof n> => !!n);
    const ids = new Set<string>();
    if (litFixtureId) ids.add(litFixtureId);
    // sample the path every metre and keep fixtures whose footprint comes within 2.5 m of a sample
    const samples: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.ceil(len));
      for (let k = 0; k <= n; k++) samples.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
    if (pts.length === 1) samples.push(pts[0]);
    for (const f of store.fixtures ?? []) {
      const b = fixtureBox(f);
      const near = samples.some((s) => Math.hypot(Math.max(Math.abs(s.x - b.cx) - b.w / 2, 0), Math.max(Math.abs(s.y - b.cz) - b.d / 2, 0)) <= 2.5);
      if (near) ids.add(f.id);
    }
    return [...ids];
  }, [current, nodes, store, litFixtureId]);

  const ribbon = useMemo(
    () => ({ walked: trip.visited, current: current?.path ?? [], ahead: legs.slice(1).flatMap((l) => l.path) }),
    [trip.visited, current, legs],
  );
  const youNode = nodes.get(trip.positionNodeId);
  const focus = useMemo<Focus>(
    () => ({
      you: youNode ? { x: youNode.x, y: youNode.y } : { x: 0, y: 0 },
      next: nextNode ? { x: nextNode.x, y: nextNode.y } : undefined,
      points: (current?.path ?? []).map((id) => nodes.get(id)).filter((n): n is NonNullable<typeof n> => !!n).map((n) => ({ x: n.x, y: n.y })),
      footprint,
    }),
    [youNode, nextNode, current, nodes, footprint],
  );

  const registry = useRef<OverlayRegistry>(new Map()).current;
  const slotPos = (locationId: string | undefined): [number, number, number] | null => {
    const loc = locationId ? store.locations.find((l) => l.id === locationId) : undefined;
    const s = loc ? slotFor(store, loc) : undefined;
    return s ? [s.center.x, s.heightM + 0.12, s.center.y] : null;
  };
  const colorOf = (locationId: string | undefined) => {
    const loc = locationId ? store.locations.find((l) => l.id === locationId) : undefined;
    return locationDepartment(store, loc)?.color;
  };
  // walking distance from you to each leg's end, along the route
  const walkTo = new Map<RouteLeg, number>();
  legs.reduce((sum, l) => (walkTo.set(l, sum + l.distanceM), sum + l.distanceM), 0);
  const stopLegs = legs.filter((l) => l.stopId !== null);
  const cards: StopCard[] = stopLegs.slice(1).map((l, i) => ({
    key: l.stopId!,
    pos: slotPos(l.locationId) ?? [nodes.get(l.nodeId)?.x ?? 0, 1.2, nodes.get(l.nodeId)?.y ?? 0],
    name: l.label,
    color: colorOf(l.locationId),
    n: i + 2,
    distance: `${Math.round(walkTo.get(l) ?? 0)} m`,
  }));
  const donePositions = trip.doneNodeIds.map((id) => slotPos(id.startsWith("loc:") ? id.slice(4) : undefined) ?? [nodes.get(id)?.x ?? 0, 1.2, nodes.get(id)?.y ?? 0]) as [number, number, number][];
  const items = useOverlayItems({
    nodes,
    positionNodeId: trip.positionNodeId,
    nextNodeId: nextIsStop ? current!.nodeId : null,
    nextPos: litSlot ? [litSlot.center.x, litSlot.heightM + 0.12, litSlot.center.y] : null,
    nextLabel,
    doneNodeIds: trip.doneNodeIds,
    cards,
    donePositions,
    nextColor: colorOf(current?.locationId),
    laneNodeId: legs.find((l) => l.label === "Checkout")?.nodeId ?? null,
    checkoutLabel,
    entranceId: store.entranceId,
    exitId: store.exitId,
  });

  // ---- gestures on the container: drag pans, shift-drag / two-finger twist orbits, pinch + wheel zoom
  const cameraRef = useRef<CameraRigHandle | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const prev = useRef<{ a: Pt; b?: Pt } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ps = [...pointers.current.values()];
    prev.current = { a: ps[0], b: ps[1] };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !prev.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ps = [...pointers.current.values()];
    const cam = cameraRef.current;
    if (!cam) return;
    if (ps.length === 1) {
      const dx = ps[0].x - prev.current.a.x;
      const dy = ps[0].y - prev.current.a.y;
      if (e.shiftKey) cam.rotate(dx * 0.3);
      else cam.pan(dx, dy);
      prev.current = { a: ps[0] };
    } else if (prev.current.b) {
      const d0 = dist(prev.current.a, prev.current.b) || 1;
      const d1 = dist(ps[0], ps[1]) || 1;
      cam.zoom(d1 / d0);
      cam.rotate(angle(ps[0], ps[1]) - angle(prev.current.a, prev.current.b));
      const m0 = { x: (prev.current.a.x + prev.current.b.x) / 2, y: (prev.current.a.y + prev.current.b.y) / 2 };
      const m1 = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
      cam.pan(m1.x - m0.x, m1.y - m0.y);
      prev.current = { a: ps[0], b: ps[1] };
    }
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const ps = [...pointers.current.values()];
    prev.current = ps.length ? { a: ps[0], b: ps[1] } : null;
  };
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    cameraRef.current?.zoom(Math.exp(-e.deltaY * 0.0015));
  };

  return (
    <div
      className={["map3d", className].filter(Boolean).join(" ")}
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      data-testid="map3d"
    >
      <Canvas
        frameloop={perf ? "always" : "demand"}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance", stencil: false }}
        camera={{ fov: 60, near: 0.5, far: 400, position: [0, 40, 60] }}
        style={{ width: "100%", height: "100%" }}
      >
        <Scene
          store={store}
          textureUrl={bundle.textureUrl}
          repeatMeters={repeatMeters}
          nodes={nodes}
          fromEntrance={fromEntrance}
          footprint={footprint}
          litSlot={litSlot}
          legFixtureIds={legFixtureIds}
          ribbon={ribbon}
          overlay={{ items, registry }}
          focus={focus}
          safe={safe}
          flat={flat}
          reducedMotion={reducedMotion}
          cameraRef={cameraRef}
          onOverZoomOut={() => onFlatChange(true)}
          perf={perf}
        />
      </Canvas>
      <div className="trip-vignette" aria-hidden />
      <OverlayDom items={items} registry={registry} />
    </div>
  );
}
