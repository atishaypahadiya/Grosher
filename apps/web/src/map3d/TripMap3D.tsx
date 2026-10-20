// The 3D trip map: a demand-rendered R3F canvas plus touch gestures on its
// container. Everything about *what* to show is derived here from the trip.

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Canvas } from "@react-three/fiber";
import { WalkGraph, type RouteLeg, type StoreGraph } from "@grosher/core";
import type { StoreBundle } from "@grosher/stores";
import type { TripState } from "../lib/trip.ts";
import { Scene, type CloseUpState } from "./Scene.tsx";
import { closeUpAt, type HeroTargetInfo } from "../hero/index.ts";
import type { CloseUpCameraHandle } from "../hero/CloseUpCamera.tsx";
import { DebugPerf, debugPerfOn } from "./DebugPerf.tsx";
import { IconArrowLeft } from "../components/Icons.tsx";
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
  /** a hero close-up opened or closed (the trip header turns to plates over the zone's dark ceiling) */
  onCloseUpChange?: (open: boolean) => void;
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

/** on the map between two close-ups: how long the next leg shows before the camera goes down again */
export const HOLD_MS = 1100;
const PRELOAD_DELAY_MS = 1200;

export default function TripMap3D({ bundle, trip, flat, onFlatChange, nextLabel, checkoutLabel, perf = false, className, safe = { top: 0.16, bottom: 0.36 }, onCloseUpChange }: TripMap3DProps) {
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

  // ---- close-ups: every stop opens one at eye level when it is next (its hero zone, or a standard close-up,
  // src/hero), or when it is tapped; back (the pill, a swipe down) returns to the overview and is remembered for
  // that stop. Between two stops the camera comes back out to the map, holds the next leg for a moment, and
  // goes down again (two stops in one hero zone: it walks over at eye level instead).
  // A trip's first close-up opens in the first render, not an effect after it: the zone (prepared on the list
  // screen) mounts with the map and compiles while the map draws its first frames.
  // ?closeup=0: none opens on its own (a tap still opens one): the overview gates measure the map itself
  const autoOpen = useMemo(() => typeof location === "undefined" || new URLSearchParams(location.search).get("closeup") !== "0", []);
  const [closeUp, setCloseUp] = useState<(CloseUpState & { stopId: string }) | null>(() => {
    if (!autoOpen) return null;
    const first = trip.route.legs[0];
    const h = first?.stopId ? closeUpAt(store, bundle.categories, first.locationId) : null;
    return h && first?.stopId ? { zone: h.zone, locationId: h.locationId, category: h.category, itemName: first.label, target: null, exiting: false, stopId: first.stopId } : null;
  });
  const [flatShelf, setFlatShelf] = useState<{ image: string; name: string } | null>(null);
  const dismissed = useRef(new Set<string>());
  // zones that failed on this device: their stops stay on the overview
  const failed = useRef(new Set<string>());
  const closeUpRef = useRef<CloseUpCameraHandle | null>(null);
  const openCloseUp = (stopId: string, locationId: string | undefined, itemName: string) => {
    const h = closeUpAt(store, bundle.categories, locationId);
    if (!h || failed.current.has(h.zone.id)) return false;
    setFlatShelf(null);
    setCloseUp((c) => (c && c.stopId === stopId && !c.exiting ? c : { zone: h.zone, locationId: h.locationId, category: h.category, itemName, target: null, exiting: false, stopId }));
    return true;
  };
  const leaveCloseUp = (remember: boolean) =>
    setCloseUp((c) => {
      if (!c) return c;
      if (remember) dismissed.current.add(c.stopId);
      // the zone never loaded (no target yet): nothing to animate back from
      return c.target ? { ...c, exiting: true } : null;
    });
  // the stop that is next, and its close-up
  const nextStop = useMemo(() => {
    if (!nextIsStop || !current?.stopId) return null;
    const h = closeUpAt(store, bundle.categories, current.locationId);
    return h ? { ...h, stopId: current.stopId, itemName: current.label } : null;
  }, [nextIsStop, current?.stopId, current?.locationId, current?.label, store, bundle.categories]);
  useEffect(() => {
    if (closeUp && !closeUp.exiting && closeUp.stopId !== nextStop?.stopId) {
      // a Got it or a Skip: another bin in the same hero zone is a walk over at eye level; anywhere else the
      // camera goes back out to the map first
      if (nextStop && nextStop.zone.id === closeUp.zone.id && nextStop.zone.quality === "hero" && !dismissed.current.has(nextStop.stopId)) openCloseUp(nextStop.stopId, nextStop.locationId, nextStop.itemName);
      else leaveCloseUp(false);
      return;
    }
    if (closeUp || !nextStop || !autoOpen || dismissed.current.has(nextStop.stopId)) return;
    // on the map: show the next leg for a moment, then go down
    const t = window.setTimeout(() => openCloseUp(nextStop.stopId, nextStop.locationId, nextStop.itemName), HOLD_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextStop?.stopId, closeUp === null, closeUp?.exiting]);
  // the stop after this one: its close-up is prepared in the background during this one (in idle time, after
  // the map has settled), so it opens with no pause; a route change cancels it
  const upcoming = useMemo(() => {
    const leg = legs.slice(1).find((l) => l.stopId);
    const h = leg ? closeUpAt(store, bundle.categories, leg.locationId) : null;
    return h && leg ? { zone: h.zone, locationId: h.locationId, category: h.category, itemName: leg.label } : null;
  }, [legs, store, bundle.categories]);
  const [preload, setPreload] = useState<typeof upcoming>(null);
  // ?preload=0 turns it off: the measurement's baseline
  const preloading = useMemo(() => typeof location === "undefined" || new URLSearchParams(location.search).get("preload") !== "0", []);
  useEffect(() => {
    if (!upcoming || !preloading || !autoOpen || failed.current.has(upcoming.zone.id)) {
      setPreload(null);
      return;
    }
    if (preload && preload.zone.id === upcoming.zone.id) {
      setPreload(upcoming);
      return;
    }
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    let id = 0;
    const start = () => setPreload(upcoming);
    // a moment for the leg's framing (or the arrival) to settle, then the browser's next idle period (Safari: a timer)
    const t = window.setTimeout(() => {
      id = w.requestIdleCallback ? w.requestIdleCallback(start, { timeout: 3000 }) : window.setTimeout(start, 200);
    }, PRELOAD_DELAY_MS);
    return () => {
      clearTimeout(t);
      if (id) (w.cancelIdleCallback ?? clearTimeout)(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcoming?.zone.id, upcoming?.category, upcoming?.itemName]);
  // mounted ahead of time, hidden: the next stop's zone while it waits to open, and the one after it
  const prepared = useMemo(() => {
    const out = [];
    if (nextStop && autoOpen && !failed.current.has(nextStop.zone.id) && !dismissed.current.has(nextStop.stopId)) out.push(nextStop);
    if (preload) out.push(preload);
    return out;
  }, [nextStop, preload]);
  // the overview fixtures the next close-up to open will hide, merged ahead (map3d/Fixtures.tsx)
  const prepareHide = (closeUp && !closeUp.exiting && closeUp.target ? preload?.zone : closeUp && !closeUp.target ? closeUp.zone : nextStop?.zone ?? preload?.zone)?.hideFixtures;
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
  const press = useRef<{ x: number; y: number; t: number; multi: boolean } | null>(null);
  const near = !!closeUp?.target && !closeUp.exiting;
  // inside a close-up until the camera is back on the map (the way out included): the overview's cards and
  // labels stay off until then
  const inside = !!closeUp?.target;
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ps = [...pointers.current.values()];
    prev.current = { a: ps[0], b: ps[1] };
    if (ps.length === 1) press.current = { x: e.clientX, y: e.clientY, t: performance.now(), multi: false };
    else if (press.current) press.current.multi = true;
  };
  /** a tap on a stop's card or dot: its key in the overlay registry, from the boxes under the point */
  const stopUnder = (x: number, y: number): string | null => {
    for (const [key, el] of registry) {
      if (key !== "next" && key !== "next-label" && !key.startsWith("stop-")) continue;
      const hit = [el, ...el.querySelectorAll<HTMLElement>("*")].some((n) => {
        const r = n.getBoundingClientRect();
        return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && getComputedStyle(n).visibility !== "hidden";
      });
      if (hit) return key.startsWith("stop-") ? key.slice(5) : (current?.stopId ?? null);
    }
    return null;
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !prev.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ps = [...pointers.current.values()];
    if (near) {
      const cu = closeUpRef.current;
      if (!cu) return;
      if (ps.length === 1) {
        const dx = ps[0].x - prev.current.a.x;
        const dy = ps[0].y - prev.current.a.y;
        if (e.shiftKey) cu.pan(dx);
        else cu.look(dx, dy);
        prev.current = { a: ps[0] };
      } else if (prev.current.b) {
        const d0 = dist(prev.current.a, prev.current.b) || 1;
        const d1 = dist(ps[0], ps[1]) || 1;
        cu.dolly(d1 / d0);
        cu.pan((ps[0].x + ps[1].x) / 2 - (prev.current.a.x + prev.current.b.x) / 2);
        prev.current = { a: ps[0], b: ps[1] };
      }
      return;
    }
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
    const p = press.current;
    if (ps.length || !p) return;
    press.current = null;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const dt = performance.now() - p.t;
    if (p.multi) return;
    // a tap during the arrival (or the way out) skips to its end
    if (closeUp && Math.hypot(dx, dy) < 8 && dt < 350 && closeUpRef.current?.skip()) return;
    // a quick flick down leaves a close-up
    if (near && dy > 90 && dt < 450 && Math.abs(dx) < dy * 0.6) {
      leaveCloseUp(true);
      return;
    }
    // a tap on a stop opens its close-up
    if (!near && Math.hypot(dx, dy) < 8 && dt < 350) {
      const stopId = stopUnder(e.clientX, e.clientY);
      const leg = stopId ? legs.find((l) => l.stopId === stopId) : undefined;
      if (leg && stopId) {
        dismissed.current.delete(stopId);
        openCloseUp(stopId, leg.locationId, leg.label);
      }
    }
  };
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const f = Math.exp(-e.deltaY * 0.0015);
    if (near) closeUpRef.current?.dolly(f);
    else cameraRef.current?.zoom(f);
  };
  const debugPerf = useMemo(() => debugPerfOn(), []);
  useEffect(() => onCloseUpChange?.(inside), [inside, onCloseUpChange]);
  // the close-up's state for the gates and ?debug=perf: none, loading (zone not ready), open, leaving
  // and its log (request → ready → leaving → closed, performance.now()), for the gates' timings
  const logged = useRef<{ stopId: string | null; state: string }>({ stopId: null, state: "none" });
  useEffect(() => {
    if (!perf && !debugPerf) return;
    const w = window as Window & { __grosherCloseUp?: unknown; __grosherCloseUpLog?: { stop: string | null; zone: string | null; quality: string | null; event: string; t: number }[] };
    const state = closeUp ? (closeUp.exiting ? "leaving" : closeUp.target ? "open" : "loading") : "none";
    w.__grosherCloseUp = closeUp ? { zone: closeUp.zone.id, quality: closeUp.zone.quality, category: closeUp.category, item: closeUp.itemName, bin: closeUp.target?.name ?? null, state } : null;
    const was = logged.current;
    const stopId = closeUp?.stopId ?? null;
    if (state !== was.state || stopId !== was.stopId) {
      const event = state === "loading" ? "request" : state === "open" ? (was.state === "loading" && was.stopId === stopId ? "ready" : "request+ready") : state === "leaving" ? "leaving" : "closed";
      (w.__grosherCloseUpLog ??= []).push({ stop: stopId ?? was.stopId, zone: closeUp?.zone.id ?? null, quality: closeUp?.zone.quality ?? null, event, t: performance.now() });
      logged.current = { stopId, state };
    }
  }, [closeUp, perf, debugPerf]);

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
        frameloop={perf || debugPerf ? "always" : "demand"}
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
          perf={perf || debugPerf}
          closeUp={closeUp}
          prepared={prepared}
          prepareHide={prepareHide}
          closeUpRef={closeUpRef}
          onHeroTarget={(t: HeroTargetInfo) => setCloseUp((c) => (c && !c.exiting ? { ...c, target: t } : c))}
          onHeroError={(_e, zoneId) => {
            failed.current.add(zoneId);
            setPreload((p) => (p?.zone.id === zoneId ? null : p));
            // no close-up on this device (no compressed textures, the chunk failed): the flat shelf image instead,
            // where the zone has one
            setCloseUp((c) => {
              if (!c || c.zone.id !== zoneId) return c;
              const image = c.zone.flatImage(c.category);
              if (image) setFlatShelf({ image, name: c.itemName });
              return null;
            });
          }}
          onCloseUpExited={() => setCloseUp(null)}
        />
      </Canvas>
      <div className="trip-vignette" aria-hidden />
      <div className={inside ? "m-overlay-hidden" : undefined}>
        <OverlayDom items={items} registry={registry} />
      </div>
      {closeUp && !closeUp.exiting && (
        <button type="button" className="pill closeup-back" onClick={() => leaveCloseUp(true)} onPointerDown={(e) => e.stopPropagation()}>
          <IconArrowLeft />
          Back to the map
        </button>
      )}
      {flatShelf && (
        <figure className="flat-shelf" data-testid="flat-shelf" onPointerDown={(e) => e.stopPropagation()}>
          <img src={flatShelf.image} alt={`The shelf where ${flatShelf.name} is, lit in lime`} />
          <figcaption>
            <span>{flatShelf.name}</span>
            <button type="button" className="pill closeup-back-inline" onClick={() => setFlatShelf(null)}>
              Close
            </button>
          </figcaption>
        </figure>
      )}
      {debugPerf && <DebugPerf mode={near ? "close-up" : "overview"} />}
    </div>
  );
}
