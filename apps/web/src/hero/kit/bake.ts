// What stays baked once the light is per pixel (light.ts): a tint and the occlusion in corners, the dark
// under a plank and at the back of a shelf that a hemisphere light alone would miss. Written into vertex
// colours (static meshes) or instance colours (bins), multiplied into the material's colour.

import { BufferAttribute, type BufferGeometry, Vector3 } from "three";
import type { V3 } from "./geom.ts";

/** extra darkening (0–1 multiplier) at a point with normal n */
export type Occlusion = (p: Vector3, n: Vector3) => number;

const P = new Vector3();
const N = new Vector3();

/** Tint a world-space geometry's vertex colours, times the occlusion at each vertex. */
export function colorize(geo: BufferGeometry, tint: V3 = [1, 1, 1], occlusion?: Occlusion): BufferGeometry {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    let o = 1;
    if (occlusion) {
      P.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      N.set(nor.getX(i), nor.getY(i), nor.getZ(i)).normalize();
      o = occlusion(P, N);
    }
    col[i * 3] = tint[0] * o;
    col[i * 3 + 1] = tint[1] * o;
    col[i * 3 + 2] = tint[2] * o;
  }
  geo.setAttribute("color", new BufferAttribute(col, 3));
  return geo;
}

/** A constant attribute on every vertex (a label's atlas cell, a grain). */
export function constant(geo: BufferGeometry, name: string, value: number[]): BufferGeometry {
  const n = geo.getAttribute("position").count;
  const a = new Float32Array(n * value.length);
  for (let i = 0; i < n; i++) a.set(value, i * value.length);
  geo.setAttribute(name, new BufferAttribute(a, value.length));
  return geo;
}

/** "#RRGGBB" → linear 0–1 triple (tints are multiplied in linear space) */
export function hex(h: string): V3 {
  const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return [v[0] ** 2.2, v[1] ** 2.2, v[2] ** 2.2];
}
