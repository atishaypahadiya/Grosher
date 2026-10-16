// The 3D trip map: a demand-rendered R3F canvas plus touch gestures on its
// container. Everything about *what* to show is derived here from the trip.

import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Canvas } from "@react-three/fiber";
import { WalkGraph, type StoreGraph } from "@grosher/core";
import type { StoreBundle } from "@grosher/stores";
import type { TripState } from "../lib/trip.ts";
import { Scene } from "./Scene.tsx";
import type { CameraRigHandle } from "./CameraRig.tsx";
import { fixtureBox, fixtureForLocation, frameLeg } from "./layout.ts";
import { OverlayDom, useOverlayItems, type NextLabel, type OverlayRegistry } from "./Overlay.tsx";

export interface TripMap3DProps {
  bundle: StoreBundle;
  trip: TripState;
  flat: boolean;
  onFlatChange: (flat: boolean) => void;
  nextLabel: NextLabel | null;
  checkoutLabel: { eyebrow: string; line: string } | null;
  perf?: boolean;
  className?: string;
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

export default function TripMap3D({ bundle, trip, flat, onFlatChange, nextLabel, checkoutLabel, perf = false, className }: TripMap3DProps) {
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

  const ribbon = useMemo(
    () => ({ walked: trip.visited, current: current?.path ?? [], ahead: legs.slice(1).flatMap((l) => l.path) }),
    [trip.visited, current, legs],
  );
  const framing = useMemo(() => {
    const pts = (current?.path ?? [trip.positionNodeId]).map((id) => nodes.get(id)).filter((n): n is NonNullable<typeof n> => !!n);
    return frameLeg(pts, nextNode);
  }, [current, trip.positionNodeId, nodes, nextNode]);

  const registry = useRef<OverlayRegistry>(new Map()).current;
  const items = useOverlayItems({
    nodes,
    positionNodeId: trip.positionNodeId,
    nextNodeId: nextIsStop ? current!.nodeId : null,
    nextLabel,
    aheadNodeIds: legs.filter((l) => l.stopId !== null).slice(1).map((l) => l.nodeId),
    doneNodeIds: trip.doneNodeIds,
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
          litFixtureId={litFixtureId}
          ribbon={ribbon}
          overlay={{ items, registry }}
          framing={framing}
          flat={flat}
          reducedMotion={reducedMotion}
          cameraRef={cameraRef}
          onOverZoomOut={() => onFlatChange(true)}
          perf={perf}
        />
      </Canvas>
      <OverlayDom items={items} registry={registry} />
    </div>
  );
}
