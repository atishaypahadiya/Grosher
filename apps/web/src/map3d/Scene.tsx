// The trip scene (DESIGN.md §3): gradient background, fog, floor with a
// white edge, fixtures, ribbon, markers, lights, bloom + vignette.

import { Suspense, useEffect, useMemo, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { CanvasTexture, SRGBColorSpace } from "three";
import type { GraphNode, StoreGraph } from "@grosher/core";
import { Fixtures } from "./Fixtures.tsx";
import { Ribbon } from "./Ribbon.tsx";
import { OverlayProjector, type OverlayItem, type OverlayRegistry } from "./Overlay.tsx";
import { CameraRig, type CameraRigHandle } from "./CameraRig.tsx";
import { Perf } from "./Perf.tsx";
import type { Framing } from "./layout.ts";

const HAZE = "#F9D7A8";
const DEEP = "#184D2E";

function gradientTexture() {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#F9D7A8");
  g.addColorStop(0.11, "#F0C27A");
  g.addColorStop(0.32, "#B9D96A");
  g.addColorStop(0.52, "#6CB26A");
  g.addColorStop(0.76, "#2E7D46");
  g.addColorStop(1, "#184D2E");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
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
  litFixtureId: string | null;
  ribbon: { walked: string[]; current: string[]; ahead: string[] };
  overlay: { items: OverlayItem[]; registry: OverlayRegistry };
  framing: Framing;
  flat: boolean;
  reducedMotion: boolean;
  cameraRef: RefObject<CameraRigHandle | null>;
  onOverZoomOut: () => void;
  perf: boolean;
}

export function Scene({ store, textureUrl, repeatMeters, nodes, fromEntrance, footprint, litFixtureId, ribbon, overlay, framing, flat, reducedMotion, cameraRef, onOverZoomOut, perf }: SceneProps) {
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
      <fogExp2 attach="fog" args={[HAZE, 0.0145]} />
      <hemisphereLight args={[HAZE, DEEP, 0.9]} />
      <directionalLight position={[-20, 30, 40]} intensity={0.5} />

      <mesh rotation-x={-Math.PI / 2} position={[footprint.x, 0, footprint.z]} name="floor">
        <planeGeometry args={[footprint.w, footprint.d]} />
        <meshBasicMaterial color="#FFFFFF" transparent opacity={0.08} />
      </mesh>
      <Line points={edge} color="#FFFFFF" transparent opacity={0.3} lineWidth={1} />

      <Suspense fallback={null}>
        <Fixtures store={store} textureUrl={textureUrl} repeatMeters={repeatMeters} litFixtureId={litFixtureId} nodes={nodes} fromEntrance={fromEntrance} />
      </Suspense>
      <Ribbon nodes={nodes} walked={ribbon.walked} current={ribbon.current} ahead={ribbon.ahead} />
      <OverlayProjector items={overlay.items} registry={overlay.registry} />
      <CameraRig ref={cameraRef} framing={framing} flat={flat} reducedMotion={reducedMotion} onOverZoomOut={onOverZoomOut} />

      <EffectComposer multisampling={0}>
        <Bloom luminanceThreshold={0.9} intensity={0.6} mipmapBlur />
        <Vignette offset={0.3} darkness={0.35} />
      </EffectComposer>
      {perf && <Perf />}
    </>
  );
}
