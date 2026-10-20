// Draw-call and frame-time readout for the performance gate. Only mounted
// with ?perf=1; writes window.__grosherPerf every frame.

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
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
      /** where the camera is (metres), for captures that wait for a pose */
      camera: [number, number, number];
    };
  }
}

export function Perf() {
  const gl = useThree((s) => s.gl);
  const last = useRef(performance.now());
  const samples = useRef<number[]>([]);
  const rendered = useRef(0);
  useEffect(() => {
    gl.info.autoReset = false; // count every pass of the frame, not just the last one
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  // Runs first in the frame: report the previous frame's totals, then reset.
  useFrame(({ gl, invalidate, camera }) => {
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
      camera: [camera.position.x, camera.position.y, camera.position.z].map((v) => Math.round(v * 100) / 100) as [number, number, number],
    };
    gl.info.reset();
    invalidate(); // keep rendering so the numbers are a steady-state measurement
  }, -1000);
  return null;
}
