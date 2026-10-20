// Draw-call and frame-time readout for the performance gate. Only mounted
// with ?perf=1; writes window.__grosherPerf every frame.

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { BufferGeometry, Mesh, Object3D } from "three";
import { productStats } from "./Products.tsx";
import { cameraStats } from "./CameraRig.tsx";
import { litStats } from "./LitSlot.tsx";
import { heroStats } from "../hero/stats.ts";

declare global {
  interface Window {
    __grosherPerf?: {
      calls: number;
      triangles: number;
      frameMs: number;
      frames: number;
      /** every frame rendered since the trip's map mounted (the close-up log stamps it: frames between events) */
      rendered: number;
      programs: number;
      instances: number;
      productFixtures: number;
      distance: number;
      tilt: number;
      lit: unknown;
      /** live GPU objects, and the open hero zone's cost (null tier: none open) */
      textures: number;
      geometries: number;
      hero: typeof heroStats;
      /** the frame's triangles by what drew them (the nearest named ancestor under the scene; frustum culling
       * not applied, so an upper bound): what the close-up gate prints for a frame over budget */
      breakdown: Record<string, number>;
      /** where the camera is (metres), for captures that wait for a pose */
      camera: [number, number, number];
    };
  }
}

export function Perf() {
  const gl = useThree((s) => s.gl);
  const last = useRef(performance.now());
  const samples = useRef<number[]>([]);
  const pending = useRef<Record<string, number>>({});
  const rendered = useRef(0);
  useEffect(() => {
    gl.info.autoReset = false; // count every pass of the frame, not just the last one
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  // Runs first in the frame: report the previous frame's totals, then reset.
  useFrame(({ gl, invalidate, camera, scene }) => {
    const now = performance.now();
    samples.current.push(now - last.current);
    last.current = now;
    if (samples.current.length > 120) samples.current.shift();
    const sorted = [...samples.current].sort((a, b) => a - b);
    const frameMs = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    window.__grosherPerf = {
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      programs: gl.info.programs?.length ?? 0,
      frameMs,
      frames: samples.current.length,
      rendered: ++rendered.current,
      instances: productStats.instances,
      productFixtures: productStats.fixtures,
      distance: Math.round(cameraStats.distance * 10) / 10,
      tilt: Math.round(cameraStats.tilt),
      lit: litStats.slot,
      textures: gl.info.memory.textures,
      geometries: gl.info.memory.geometries,
      hero: { ...heroStats },
      breakdown: pending.current,
      camera: [camera.position.x, camera.position.y, camera.position.z].map((v) => Math.round(v * 100) / 100) as [number, number, number],
    };
    gl.info.reset();
    // what this frame is about to draw, reported with its totals at the next one
    const out: Record<string, number> = {};
    const walk = (o: Object3D, label: string) => {
      if (!o.visible) return;
      const name = label || o.name || "";
      const m = o as Mesh & { isInstancedMesh?: boolean; count?: number; isLine?: boolean };
      if ((m as Mesh).isMesh || m.isLine) {
        const g = m.geometry as BufferGeometry | undefined;
        const n = g ? (g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0)) / 3 : 0;
        const key = name || `(${o.type})`;
        out[key] = (out[key] ?? 0) + Math.round(n * (m.isInstancedMesh ? (m.count ?? 1) : 1));
      }
      for (const c of o.children) walk(c, name);
    };
    for (const c of scene.children) walk(c, c.name);
    pending.current = out;
    invalidate(); // keep rendering so the numbers are a steady-state measurement
  }, -1000);
  return null;
}
