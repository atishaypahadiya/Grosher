// ?debug=perf: a small readout over the 3D map for checking a phone by hand: frames per second, frame time,
// draw calls and triangles per frame, live textures and geometries, the open hero zone's texture memory and
// tier, and the JS heap where the browser tells (not Safari). Reads what Perf.tsx writes every frame (the
// map renders continuously while it is on), updates twice a second.

import { useEffect, useState } from "react";

export const debugPerfOn = () => typeof location !== "undefined" && new URLSearchParams(location.search).get("debug") === "perf";

export function DebugPerf({ mode }: { mode: string }) {
  const [text, setText] = useState("measuring…");
  useEffect(() => {
    const id = setInterval(() => {
      const p = window.__grosherPerf;
      if (!p) return;
      const fps = p.frameMs > 0 ? 1000 / p.frameMs : 0;
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      const lines = [
        `${mode} · ${fps.toFixed(0)} fps · ${p.frameMs.toFixed(1)} ms`,
        `${p.calls} calls · ${(p.triangles / 1000).toFixed(0)}k tris`,
        `${p.textures} textures · ${p.geometries} geometries`,
        p.hero.tier ? `hero ${p.hero.tier} · ${(p.hero.gpuBytes / 2 ** 20).toFixed(1)} MB tex · ${(p.hero.triangles / 1000).toFixed(0)}k tris · ${p.hero.loadMs} ms load` : "no hero zone open",
        mem ? `heap ${(mem.usedJSHeapSize / 2 ** 20).toFixed(0)} MB` : "heap n/a",
      ];
      setText(lines.join("\n"));
    }, 500);
    return () => clearInterval(id);
  }, [mode]);
  return (
    <pre className="debug-perf" data-testid="debug-perf" aria-live="off">
      {text}
    </pre>
  );
}
