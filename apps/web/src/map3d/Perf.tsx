// Draw-call and frame-time readout for the performance gate. Only mounted
// with ?perf=1; writes window.__grosherPerf every frame.

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

declare global {
  interface Window {
    __grosherPerf?: { calls: number; triangles: number; frameMs: number; frames: number; programs: number };
  }
}

export function Perf() {
  const gl = useThree((s) => s.gl);
  const last = useRef(performance.now());
  const samples = useRef<number[]>([]);
  useEffect(() => {
    gl.info.autoReset = false; // count every pass of the frame, not just the last one
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  // Runs first in the frame: report the previous frame's totals, then reset.
  useFrame(({ gl, invalidate }) => {
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
    };
    gl.info.reset();
    invalidate(); // keep rendering so the numbers are a steady-state measurement
  }, -1000);
  return null;
}
