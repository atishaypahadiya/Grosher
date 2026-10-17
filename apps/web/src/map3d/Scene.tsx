// The trip scene (DESIGN.md §3): gradient background, fog, floor with a
// white edge, fixtures, ribbon, markers, lights, bloom + vignette.

import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { EffectComposer, SelectiveBloom } from "@react-three/postprocessing";
import { CanvasTexture, SRGBColorSpace, type DirectionalLight, type HemisphereLight, type Mesh, type Object3D } from "three";
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
  const edge = useMemo<[number, number, number][]>(() => {
    const { x, z, w, d } = footprint;
    return [
      [x - w / 2, 0.01, z - d / 2],
      [x + w / 2, 0.01, z - d / 2],
      [x + w / 2, 0.01, z + d / 2],
      [x - w / 2, 0.01, z + d / 2],
      [x - w / 2, 0.01, z - d / 2],
    ];
  }, [footprint]);

  return (
    <>
      <Background />
      {/* ~12% haze at 60 m, ~30% at 100 m: with the CSS overlay the next stop never loses more than 40% */}
      <fogExp2 attach="fog" args={[HAZE, 0.006]} />
      <hemisphereLight ref={hemi} args={[HAZE, DEEP, 0.9]} />
      <directionalLight ref={sun} position={[-20, 30, 40]} intensity={0.5} />

      <mesh rotation-x={-Math.PI / 2} position={[footprint.x, 0, footprint.z]} name="floor">
        <planeGeometry args={[footprint.w, footprint.d]} />
        <meshBasicMaterial color="#FFFFFF" transparent opacity={0.08} />
      </mesh>
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
