// The trip scene (DESIGN.md §3): gradient background, fog, floor with a
// white edge, fixtures, ribbon, markers, lights, bloom + vignette.

import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { EffectComposer, SelectiveBloom } from "@react-three/postprocessing";
import { BufferGeometry, CanvasTexture, Float32BufferAttribute, LineBasicMaterial, LineSegments, Object3D, Shape, ShapeGeometry, SRGBColorSpace, type DirectionalLight, type HemisphereLight, type Mesh } from "three";
import type { SelectiveBloomEffect } from "postprocessing";
import type { GraphNode, StoreGraph } from "@grosher/core";
import { Fixtures } from "./Fixtures.tsx";
import { LitSlot } from "./LitSlot.tsx";
import type { Slot } from "@grosher/stores";
import { Products } from "./Products.tsx";
import { Ribbon } from "./Ribbon.tsx";
import { OverlayProjector, type OverlayItem, type OverlayRegistry } from "./Overlay.tsx";
import { CameraRig, MIN_DISTANCE_PINCH, type CameraRigHandle } from "./CameraRig.tsx";
import { Perf } from "./Perf.tsx";
import type { Focus, SafeArea } from "./CameraRig.tsx";

const HAZE = "#FF9E6B"; // --haze: the fog and the hemisphere light's sky
const DEEP = "#184D2E";

function gradientTexture() {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#FF9E6B");
  g.addColorStop(0.11, "#F2703A");
  g.addColorStop(0.32, "#E2A23C");
  g.addColorStop(0.52, "#86B84A");
  g.addColorStop(0.76, "#2E7D46");
  g.addColorStop(1, "#184D2E");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Bloom intensity follows the camera distance: full at ≥ 36 m, 40% at the pinch minimum. */
function BloomDriver({ effect, distanceRef, full }: { effect: RefObject<SelectiveBloomEffect | null>; distanceRef: { current: number }; full: number }) {
  useFrame(() => {
    const e = effect.current;
    if (!e) return;
    const t = Math.max(0, Math.min(1, (distanceRef.current - MIN_DISTANCE_PINCH) / (36 - MIN_DISTANCE_PINCH)));
    e.intensity = full * (0.4 + 0.6 * t);
  });
  return null;
}

function Background() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const t = gradientTexture();
    scene.background = t;
    return () => {
      scene.background = null;
      t.dispose();
    };
  }, [scene]);
  return null;
}

/** The floor and its edge follow the building's outline (Grosher's cut corner) when the store has one. */
function floorShape(outline: [number, number][]) {
  // the floor lies in x / −y before the −90° turn about x, so map y becomes −y here
  const shape = new Shape(outline.map(([x, y]) => ({ x, y: -y }) as never));
  return new ShapeGeometry(shape);
}

/**
 * Daylight through the roof: each skylight's frame (rim and mullions every ~4 m) overhead in one line batch,
 * a faint glazing pane, a pool of light on the floor under it and white spots on the zone's fixtures; the
 * rest of the store stays under the warm light. One store-wide line batch and two planes per skylight.
 */
function Skylights({ store }: { store: StoreGraph }) {
  const lights = store.skylights ?? [];
  const frame = useMemo(() => {
    const pts: number[] = [];
    for (const s of lights) {
      const h = s.height ?? 6;
      const xs = s.polygon.map((p) => p[0]);
      const ys = s.polygon.map((p) => p[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const seg = (ax: number, ay: number, bx: number, by: number) => pts.push(ax, h, ay, bx, h, by);
      seg(x0, y0, x1, y0);
      seg(x1, y0, x1, y1);
      seg(x1, y1, x0, y1);
      seg(x0, y1, x0, y0);
      const n = Math.max(1, Math.round((x1 - x0) / 4));
      for (let i = 1; i < n; i++) seg(x0 + ((x1 - x0) * i) / n, y0, x0 + ((x1 - x0) * i) / n, y1);
      seg(x0, (y0 + y1) / 2, x1, (y0 + y1) / 2);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pts, 3));
    return new LineSegments(g, new LineBasicMaterial({ color: "#FFFFFF", transparent: true, opacity: 0.85 }));
  }, [lights]);
  const spots = useMemo(
    () =>
      lights.flatMap((s) => {
        const xs = s.polygon.map((p) => p[0]);
        const ys = s.polygon.map((p) => p[1]);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        const n = Math.max(1, Math.round((x1 - x0) / (y1 - y0)));
        return Array.from({ length: n }, (_, i) => {
          const target = new Object3D();
          target.position.set(x0 + ((x1 - x0) * (i + 0.5)) / n, 0, (y0 + y1) / 2);
          return { key: `${s.id}-${i}`, target, reach: Math.hypot((x1 - x0) / n, y1 - y0) / 2 };
        });
      }),
    [lights],
  );
  if (!lights.length) return null;
  return (
    <group name="skylights">
      <primitive object={frame} />
      {lights.map((s) => {
        const xs = s.polygon.map((p) => p[0]);
        const ys = s.polygon.map((p) => p[1]);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        return (
          <group key={s.id}>
            <mesh rotation-x={-Math.PI / 2} position={[(x0 + x1) / 2, s.height ?? 6, (y0 + y1) / 2]}>
              <planeGeometry args={[x1 - x0, y1 - y0]} />
              <meshBasicMaterial color="#FFFFFF" transparent opacity={0.07} depthWrite={false} />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} position={[(x0 + x1) / 2, 0.015, (y0 + y1) / 2]}>
              <planeGeometry args={[x1 - x0, y1 - y0]} />
              <meshBasicMaterial color="#FFFFFF" transparent opacity={0.16} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
      {spots.map((sp) => (
        <group key={sp.key}>
          <primitive object={sp.target} />
          <spotLight position={[sp.target.position.x, 16, sp.target.position.z]} target={sp.target} angle={Math.atan(sp.reach / 16) * 1.15} penumbra={0.7} intensity={1.1} decay={0} distance={0} color="#FFFFFF" />
        </group>
      ))}
    </group>
  );
}

export interface SceneProps {
  store: StoreGraph;
  textureUrl: (file: string) => string;
  repeatMeters: number;
  nodes: Map<string, GraphNode>;
  fromEntrance: Map<string, number>;
  footprint: { x: number; z: number; w: number; d: number };
  /** the next stop's bay × shelf × face */
  litSlot: Slot | null;
  /** fixtures along the current leg plus the next stop's */
  legFixtureIds: string[];
  ribbon: { walked: string[]; current: string[]; ahead: string[] };
  overlay: { items: OverlayItem[]; registry: OverlayRegistry };
  focus: Focus;
  safe: SafeArea;
  flat: boolean;
  reducedMotion: boolean;
  cameraRef: RefObject<CameraRigHandle | null>;
  onOverZoomOut: () => void;
  perf: boolean;
}

export function Scene({ store, textureUrl, repeatMeters, nodes, fromEntrance, footprint, litSlot, legFixtureIds, ribbon, overlay, focus, safe, flat, reducedMotion, cameraRef, onOverZoomOut, perf }: SceneProps) {
  const [litMesh, setLitMesh] = useState<Mesh | null>(null);
  const [glowLine, setGlowLine] = useState<Object3D | null>(null);
  const bloomRef = useRef<SelectiveBloomEffect | null>(null);
  const distanceRef = useRef(36);
  const [settled, setSettled] = useState<{ x: number; y: number; z: number } | null>(null);
  const onSettle = useMemo(
    () => (cam: { x: number; y: number; z: number }) =>
      setSettled((s) => (s && Math.hypot(s.x - cam.x, s.y - cam.y, s.z - cam.z) < 0.5 ? s : { x: cam.x, y: cam.y, z: cam.z })),
    [],
  );
  const selection = useMemo(() => [litMesh, glowLine].filter((o): o is Object3D => !!o), [litMesh, glowLine]);
  const hemi = useRef<HemisphereLight>(null);
  const sun = useRef<DirectionalLight>(null);
  const outline = store.outline;
  const floor = useMemo(() => (outline ? floorShape(outline) : null), [outline]);
  // a store with daylight is otherwise lit warm, like track lighting
  const daylit = !!store.skylights?.length;
  const edge = useMemo<[number, number, number][]>(() => {
    if (outline) return [...outline, outline[0]].map(([x, y]) => [x, 0.01, y]);
    const { x, z, w, d } = footprint;
    return [
      [x - w / 2, 0.01, z - d / 2],
      [x + w / 2, 0.01, z - d / 2],
      [x + w / 2, 0.01, z + d / 2],
      [x - w / 2, 0.01, z + d / 2],
      [x - w / 2, 0.01, z - d / 2],
    ];
  }, [footprint, outline]);

  return (
    <>
      <Background />
      {/* ~12% haze at 60 m, ~30% at 100 m: with the CSS overlay the next stop never loses more than 40% */}
      <fogExp2 attach="fog" args={[HAZE, 0.006]} />
      <hemisphereLight ref={hemi} args={[HAZE, DEEP, 0.9]} />
      <directionalLight ref={sun} position={[-20, 30, 40]} intensity={daylit ? 0.6 : 0.5} color={daylit ? "#FFD9B0" : "#FFFFFF"} />

      {floor ? (
        <mesh rotation-x={-Math.PI / 2} geometry={floor} name="floor">
          <meshBasicMaterial color="#FFFFFF" transparent opacity={0.08} />
        </mesh>
      ) : (
        <mesh rotation-x={-Math.PI / 2} position={[footprint.x, 0, footprint.z]} name="floor">
          <planeGeometry args={[footprint.w, footprint.d]} />
          <meshBasicMaterial color="#FFFFFF" transparent opacity={0.08} />
        </mesh>
      )}
      <Skylights store={store} />
      <Line points={edge} color="#FFFFFF" transparent opacity={0.3} lineWidth={1} />

      <Suspense fallback={null}>
        <Fixtures store={store} textureUrl={textureUrl} repeatMeters={repeatMeters} nodes={nodes} fromEntrance={fromEntrance} />
        <Products store={store} textureUrl={textureUrl} settled={settled} priority={legFixtureIds} you={{ x: focus.you.x, z: focus.you.y }} />
      </Suspense>
      <Ribbon nodes={nodes} walked={ribbon.walked} current={ribbon.current} ahead={ribbon.ahead} onGlowLine={setGlowLine} />
      {litSlot && <LitSlot slot={litSlot} onMesh={setLitMesh} />}
      <OverlayProjector items={overlay.items} registry={overlay.registry} safe={safe} />
      <CameraRig ref={cameraRef} focus={focus} safe={safe} distanceRef={distanceRef} onSettle={onSettle} flat={flat} reducedMotion={reducedMotion} onOverZoomOut={onOverZoomOut} />
      <BloomDriver effect={bloomRef} distanceRef={distanceRef} full={0.7} />

      {/* One bloom pass, selective: the lit fixture and the current leg's wide ribbon copy. The rest of the
          frame never blooms, so the haze stays clean and the pass stays within the draw-call budget. */}
      <EffectComposer multisampling={0}>
        {selection.length ? <SelectiveBloom ref={bloomRef} selection={selection} lights={[hemi, sun]} luminanceThreshold={0.15} intensity={0.7} radius={0.42} mipmapBlur ignoreBackground /> : <></>}
      </EffectComposer>
      {perf && <Perf />}
    </>
  );
}
