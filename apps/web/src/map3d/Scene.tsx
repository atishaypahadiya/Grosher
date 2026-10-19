// The trip scene (DESIGN.md §3): gradient background, fog, floor with a
// white edge, fixtures, ribbon, markers, lights, bloom + vignette.

import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentType, type LazyExoticComponent, type ReactNode, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { EffectComposer, SelectiveBloom } from "@react-three/postprocessing";
import { BufferGeometry, CanvasTexture, Color, Float32BufferAttribute, LineBasicMaterial, LineSegments, Object3D, Shape, ShapeGeometry, SRGBColorSpace, type DirectionalLight, type FogExp2, type Group, type HemisphereLight, type Mesh } from "three";
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
import type { HeroTargetInfo, HeroZoneComponentProps, HeroZoneEntry } from "../hero/index.ts";
import { CloseUpCamera, type CloseUpCameraHandle } from "../hero/CloseUpCamera.tsx";

/** A hero close-up as the 3D map asks for it. */
export interface CloseUpState {
  zone: HeroZoneEntry;
  category: string;
  itemName: string;
  /** set once the zone has picked its bin */
  target: HeroTargetInfo | null;
  exiting: boolean;
}

// one lazy component per zone, so re-renders never re-import it
const ZONE_COMPONENTS = new Map<string, LazyExoticComponent<ComponentType<HeroZoneComponentProps>>>();
const zoneComponent = (z: HeroZoneEntry) => {
  let c = ZONE_COMPONENTS.get(z.id);
  if (!c) ZONE_COMPONENTS.set(z.id, (c = lazy(z.load)));
  return c;
};

/** A failed hero chunk or texture load: report it (the map shows the flat shelf image) and render nothing. */
class ZoneBoundary extends Component<{ onError: (e: Error) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: Error) {
    this.props.onError(e);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const HAZE = "#FF9E6B"; // --haze: the fog and the hemisphere light's sky
const DEEP = "#184D2E";

const GROUND: [number, string][] = [
  [0, "#FF9E6B"],
  [0.11, "#F2703A"],
  [0.32, "#E2A23C"],
  [0.52, "#86B84A"],
  [0.76, "#2E7D46"],
  [1, "#184D2E"],
];
/** in a close-up the store beyond the zone fades into a warm dark: the fog and the background both */
const CLOSE_DARK = "#2A1F17";
const CLOSE_FOG = 0.03;

/** the ground gradient, mixed `k` of the way toward the close-up's dark */
function paintGradient(c: HTMLCanvasElement, k: number) {
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  const dark = new Color(CLOSE_DARK);
  for (const [at, hex] of GROUND) g.addColorStop(at, `#${new Color(hex).lerp(dark, k).getHexString()}`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
}
function gradientTexture() {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 512;
  paintGradient(c, 0);
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

function Background({ envRef }: { envRef: { current: number } }) {
  const scene = useThree((s) => s.scene);
  const tex = useRef<CanvasTexture | null>(null);
  const last = useRef(0);
  useEffect(() => {
    const t = gradientTexture();
    tex.current = t;
    scene.background = t;
    return () => {
      scene.background = null;
      t.dispose();
    };
  }, [scene]);
  useFrame(() => {
    const t = tex.current;
    const k = envRef.current;
    if (!t || Math.abs(k - last.current) < 0.02) return;
    last.current = k;
    paintGradient(t.image as HTMLCanvasElement, k);
    t.needsUpdate = true;
  });
  return null;
}

/**
 * The blend between the overview and a close-up (`envRef`, 0 … 1, from the close-up camera's height): the
 * fog thickens into the warm dark, the overview's own lights and the skylight's daylight spots fade, so the
 * store goes from the overview's haze to the zone's lamplight as the camera comes down, never in one cut.
 */
function EnvDriver({ envRef, fog, hemi, sun, sky, daylit }: { envRef: { current: number }; fog: RefObject<FogExp2 | null>; hemi: RefObject<HemisphereLight | null>; sun: RefObject<DirectionalLight | null>; sky: RefObject<Group | null>; daylit: boolean }) {
  const last = useRef(-1);
  const haze = useMemo(() => new Color(HAZE), []);
  const dark = useMemo(() => new Color(CLOSE_DARK), []);
  useFrame(() => {
    const k = envRef.current;
    if (Math.abs(k - last.current) < 0.003) return;
    last.current = k;
    if (fog.current) {
      fog.current.color.copy(haze).lerp(dark, k);
      fog.current.density = 0.006 + (CLOSE_FOG - 0.006) * k;
    }
    if (hemi.current) hemi.current.intensity = 0.9 * (1 - k);
    if (sun.current) sun.current.intensity = (daylit ? 0.6 : 0.5) * (1 - k);
    // the skylights' frame and panes go, their spots fade: a light never leaves the scene (that would
    // recompile every material mid-move), it only dims
    sky.current?.traverse((o) => {
      const l = o as Object3D & { isLight?: boolean; intensity: number; userData: { base?: number } };
      if (l.isLight) l.intensity = (l.userData.base ??= l.intensity) * (1 - k);
      else if (o !== sky.current && "geometry" in o) o.visible = k < 0.5;
    });
  });
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
  /** an open hero close-up: its zone at full detail, the eye-level camera, its own light */
  closeUp?: CloseUpState | null;
  closeUpRef?: RefObject<CloseUpCameraHandle | null>;
  onHeroTarget?: (t: HeroTargetInfo) => void;
  onHeroError?: (e: Error) => void;
  onCloseUpExited?: () => void;
}

export function Scene({ store, textureUrl, repeatMeters, nodes, fromEntrance, footprint, litSlot, legFixtureIds, ribbon, overlay, focus, safe, flat, reducedMotion, cameraRef, onOverZoomOut, perf, closeUp, closeUpRef, onHeroTarget, onHeroError, onCloseUpExited }: SceneProps) {
  const [litMesh, setLitMesh] = useState<Mesh | null>(null);
  const [heroLit, setHeroLit] = useState<Mesh | null>(null);
  // the zone loads (and picks its bin) while the overview stays as it is; the scene turns to the close-up, and
  // the camera starts down, only once the zone is ready
  const near = !!closeUp?.target;
  // 0 overview … 1 eye level, written by the close-up camera every frame it moves
  const envRef = useRef(0);
  if (!closeUp) envRef.current = 0;
  const fogRef = useRef<FogExp2>(null);
  const skyRef = useRef<Group>(null);
  const Zone = closeUp ? zoneComponent(closeUp.zone) : null;
  const [glowLine, setGlowLine] = useState<Object3D | null>(null);
  const bloomRef = useRef<SelectiveBloomEffect | null>(null);
  const distanceRef = useRef(36);
  const [settled, setSettled] = useState<{ x: number; y: number; z: number } | null>(null);
  const onSettle = useMemo(
    () => (cam: { x: number; y: number; z: number }) =>
      setSettled((s) => (s && Math.hypot(s.x - cam.x, s.y - cam.y, s.z - cam.z) < 0.5 ? s : { x: cam.x, y: cam.y, z: cam.z })),
    [],
  );
  const selection = useMemo(() => (near ? [heroLit] : [litMesh, glowLine]).filter((o): o is Object3D => !!o), [near, heroLit, litMesh, glowLine]);
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
      <Background envRef={envRef} />
      {/* ~12% haze at 60 m, ~30% at 100 m: with the CSS overlay the next stop never loses more than 40%. In a
          close-up the store around the zone fades into a warm dark instead (EnvDriver), and the zone brings
          its own light. */}
      <fogExp2 ref={fogRef} attach="fog" args={[HAZE, 0.006]} />
      <hemisphereLight ref={hemi} args={[HAZE, DEEP, 0.9]} />
      <directionalLight ref={sun} position={[-20, 30, 40]} intensity={daylit ? 0.6 : 0.5} color={daylit ? "#FFD9B0" : "#FFFFFF"} />
      <EnvDriver envRef={envRef} fog={fogRef} hemi={hemi} sun={sun} sky={skyRef} daylit={daylit} />

      {near ? null : floor ? (
        <mesh rotation-x={-Math.PI / 2} geometry={floor} name="floor">
          <meshBasicMaterial color="#FFFFFF" transparent opacity={0.08} />
        </mesh>
      ) : (
        <mesh rotation-x={-Math.PI / 2} position={[footprint.x, 0, footprint.z]} name="floor">
          <planeGeometry args={[footprint.w, footprint.d]} />
          <meshBasicMaterial color="#FFFFFF" transparent opacity={0.08} />
        </mesh>
      )}
      <group ref={skyRef}>
        <Skylights store={store} />
      </group>
      {!near && <Line points={edge} color="#FFFFFF" transparent opacity={0.3} lineWidth={1} />}

      <Suspense fallback={null}>
        <Fixtures store={store} textureUrl={textureUrl} repeatMeters={repeatMeters} nodes={nodes} fromEntrance={fromEntrance} hide={closeUp?.zone.hideFixtures} dimRef={closeUp ? envRef : undefined} />
        {!near && <Products store={store} textureUrl={textureUrl} settled={settled} priority={legFixtureIds} you={{ x: focus.you.x, z: focus.you.y }} />}
      </Suspense>
      {Zone && closeUp && (
        <ZoneBoundary onError={(e) => onHeroError?.(e)}>
          {/* hidden until the scene turns to the close-up: never drawn over the overview's products and ribbon */}
          <group visible={near}>
            <Suspense fallback={null}>
              <Zone store={store} category={closeUp.category} itemName={closeUp.itemName} onTarget={(t) => onHeroTarget?.(t)} onLit={setHeroLit} onError={(e) => onHeroError?.(e)} />
            </Suspense>
          </group>
        </ZoneBoundary>
      )}
      {!near && <Ribbon nodes={nodes} walked={ribbon.walked} current={ribbon.current} ahead={ribbon.ahead} onGlowLine={setGlowLine} />}
      {!near && litSlot && <LitSlot slot={litSlot} onMesh={setLitMesh} />}
      {!near && <OverlayProjector items={overlay.items} registry={overlay.registry} safe={safe} />}
      <CameraRig ref={cameraRef} focus={focus} safe={safe} distanceRef={distanceRef} onSettle={onSettle} flat={flat} reducedMotion={reducedMotion} onOverZoomOut={onOverZoomOut} paused={near} />
      {closeUp?.target && (
        <CloseUpCamera
          ref={closeUpRef}
          target={closeUp.target}
          safe={safe}
          reducedMotion={reducedMotion}
          exiting={closeUp.exiting}
          returnView={() => cameraRef.current!.view()}
          onExited={() => onCloseUpExited?.()}
          distanceRef={distanceRef}
          envRef={envRef}
        />
      )}
      <BloomDriver effect={bloomRef} distanceRef={distanceRef} full={0.7} />

      {/* One bloom pass, selective: the lit fixture and the current leg's wide ribbon copy. The rest of the
          frame never blooms, so the haze stays clean and the pass stays within the draw-call budget. */}
      <EffectComposer multisampling={0}>
        {selection.length ? <SelectiveBloom ref={bloomRef} selection={selection} lights={near ? [] : [hemi, sun]} luminanceThreshold={0.15} intensity={0.7} radius={0.42} mipmapBlur ignoreBackground /> : <></>}
      </EffectComposer>
      {perf && <Perf />}
    </>
  );
}
