// Baked light: the track spotlights' warm pools, a dim ambient and a little contact shadow, computed once per
// vertex (static geometry) or per instance (products) into colours that the materials multiply in. The
// runtime then needs only a hemisphere and one directional light (for the normal maps' relief): no
// realtime spotlights, no shadow maps.

import { BufferAttribute, type BufferGeometry, Vector3 } from "three";
import type { V3 } from "./geom.ts";

export interface Spot {
  pos: V3;
  target: V3;
  /** half-angle of the cone, radians */
  angle: number;
  /** 0–1: the soft part of the cone's edge */
  penumbra: number;
  intensity: number;
}

export interface BakeSetup {
  spots: Spot[];
  /** the spots' colour: ~3000 K */
  warm: V3;
  ambient: V3;
  /** distance at which a spot gives its full intensity (inverse square beyond, softened before) */
  reference: number;
  /** extra darkening (0–1 multiplier) at a point: contact shadow under planks, at wall foot */
  occlusion?: (p: Vector3, n: Vector3) => number;
}

/** 3000 K, normalised: (255, 180, 107) */
export const WARM_3000K: V3 = [1.0, 0.706, 0.42];

const L = new Vector3();
const D = new Vector3();
const P = new Vector3();
const N = new Vector3();

export function irradiance(b: BakeSetup, p: Vector3, n: Vector3, out: V3 = [0, 0, 0]): V3 {
  let r = b.ambient[0];
  let g = b.ambient[1];
  let bl = b.ambient[2];
  for (const s of b.spots) {
    L.set(s.pos[0] - p.x, s.pos[1] - p.y, s.pos[2] - p.z);
    const d2 = L.lengthSq();
    const d = Math.sqrt(d2);
    L.multiplyScalar(1 / d);
    const lambert = n.dot(L);
    if (lambert <= 0) continue;
    D.set(s.target[0] - s.pos[0], s.target[1] - s.pos[1], s.target[2] - s.pos[2]).normalize();
    const cosA = -L.dot(D);
    const outer = Math.cos(s.angle);
    const inner = Math.cos(s.angle * (1 - s.penumbra));
    if (cosA <= outer) continue;
    const t = Math.min(1, (cosA - outer) / Math.max(1e-4, inner - outer));
    const cone = t * t * (3 - 2 * t);
    const fall = (b.reference * b.reference) / Math.max(d2, b.reference * b.reference * 0.5);
    const e = s.intensity * cone * lambert * fall;
    r += e * b.warm[0];
    g += e * b.warm[1];
    bl += e * b.warm[2];
  }
  const o = b.occlusion ? b.occlusion(p, n) : 1;
  out[0] = Math.min(1, r * o);
  out[1] = Math.min(1, g * o);
  out[2] = Math.min(1, bl * o);
  return out;
}

/** Bake the light into a world-space geometry's vertex colours, times an optional tint. */
export function bakeVertexColors(geo: BufferGeometry, b: BakeSetup, tint: V3 = [1, 1, 1]): BufferGeometry {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const col = new Float32Array(pos.count * 3);
  const c: V3 = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    P.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    N.set(nor.getX(i), nor.getY(i), nor.getZ(i)).normalize();
    irradiance(b, P, N, c);
    col[i * 3] = c[0] * tint[0];
    col[i * 3 + 1] = c[1] * tint[1];
    col[i * 3 + 2] = c[2] * tint[2];
  }
  geo.setAttribute("color", new BufferAttribute(col, 3));
  return geo;
}

/** "#RRGGBB" → linear-ish 0–1 triple (the tints are multiplied in vertex colours) */
export function hex(h: string): V3 {
  const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return [v[0] ** 2.2, v[1] ** 2.2, v[2] ** 2.2];
}
