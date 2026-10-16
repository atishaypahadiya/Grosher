// Writes demo/textures/<dept>.jpg (512×512, department color + soft grain)
// and demo/textures/textures.json, so the 3D map has something to tile
// before the survey walk. Real photos replace these file for file.
//
// Run: npm run gen:textures -w @grosher/stores

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encode } from "jpeg-js";
import { DEPARTMENTS } from "../src/departments.ts";

const SIZE = 512;
const QUALITY = 80;
const REPEAT_METERS = 2;

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Coarse random grid, bilinearly sampled: slow mottling under the fine grain. */
function mottle(rand: () => number, cells: number) {
  const g = Array.from({ length: (cells + 1) * (cells + 1) }, () => rand() * 2 - 1);
  return (u: number, v: number) => {
    const x = u * cells;
    const y = v * cells;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const at = (i: number, j: number) => g[Math.min(j, cells) * (cells + 1) + Math.min(i, cells)];
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
    const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bot * fy;
  };
}

function texture(color: string, seed: number): Buffer {
  const rand = mulberry32(seed);
  const [r, g, b] = hex(color);
  const slow = mottle(rand, 6);
  const mid = mottle(rand, 24);
  const data = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const v = y / SIZE;
      // soft shelf bands: a gentle sinusoid along y so tiled runs read as shelving
      const band = Math.sin(v * Math.PI * 6) * 4;
      const l = slow(u, v) * 10 + mid(u, v) * 6 + (rand() * 2 - 1) * 7 + band;
      const i = (y * SIZE + x) * 4;
      data[i] = clamp(r + l);
      data[i + 1] = clamp(g + l);
      data[i + 2] = clamp(b + l);
      data[i + 3] = 255;
    }
  }
  return encode({ data, width: SIZE, height: SIZE }, QUALITY).data;
}

const out = join(import.meta.dirname, "..", "demo", "textures");
mkdirSync(out, { recursive: true });
const manifest: Record<string, { file: string; w: number; h: number; shotAt: string | null; repeatMeters: number }> = {};
DEPARTMENTS.forEach((d, i) => {
  if (!d.texture) return;
  const jpg = texture(d.color, 1000 + i);
  writeFileSync(join(out, d.texture), jpg);
  manifest[d.id] = { file: d.texture, w: SIZE, h: SIZE, shotAt: null, repeatMeters: REPEAT_METERS };
  console.log(`${d.texture}  ${(jpg.length / 1024).toFixed(0)} KB`);
});
writeFileSync(join(out, "textures.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${out}`);
