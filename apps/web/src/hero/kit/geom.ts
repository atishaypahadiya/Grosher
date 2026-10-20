// Shelf kit geometry helpers. Everything is built in world space (metres; x and z are the store map's x and
// y, y is up), baked (bake.ts) and merged per material, so a whole zone is a few draw calls.

import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, Euler, LatheGeometry, Matrix4, PlaneGeometry, Quaternion, Vector2, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export type V3 = [number, number, number];
/** an atlas rectangle [u0, v0, u1, v1] */
export type Rect = [number, number, number, number];

/** Non-indexed copy with position, normal and uv only, so differently built pieces merge. */
export function clean(g: BufferGeometry): BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  const out = new BufferGeometry();
  out.setAttribute("position", n.getAttribute("position"));
  out.setAttribute("normal", n.getAttribute("normal") ?? new BufferAttribute(new Float32Array(n.getAttribute("position").count * 3), 3));
  const uv = n.getAttribute("uv") ?? new BufferAttribute(new Float32Array(n.getAttribute("position").count * 2), 2);
  out.setAttribute("uv", uv);
  if (!n.getAttribute("normal")) out.computeVertexNormals();
  return out;
}

export interface Place {
  pos?: V3;
  rot?: V3; // Euler XYZ, radians
  scale?: V3;
}

export function place(g: BufferGeometry, p: Place): BufferGeometry {
  const m = new Matrix4().compose(new Vector3(...(p.pos ?? [0, 0, 0])), new Quaternion().setFromEuler(new Euler(...(p.rot ?? [0, 0, 0]))), new Vector3(...(p.scale ?? [1, 1, 1])));
  g.applyMatrix4(m);
  return g;
}

/** UVs of every vertex mapped into an atlas rectangle (the geometry's own 0–1 UVs, inset a little against mip bleed). */
export function toRect(g: BufferGeometry, r: Rect, insetPx = 0, atlasPx = 1024): BufferGeometry {
  const uv = g.getAttribute("uv");
  const i = insetPx / atlasPx;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, r[0] + i + uv.getX(k) * (r[2] - r[0] - 2 * i), r[1] + i + uv.getY(k) * (r[3] - r[1] - 2 * i));
  uv.needsUpdate = true;
  return g;
}

/** A box whose texture repeats every `tile` metres on every face (tileable materials). */
export function tiledBox(w: number, h: number, d: number, tile = 1): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  const uv = g.getAttribute("uv");
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  return clean(g);
}

/** A plank with slightly rounded edges; its grain runs along x. */
export function roundedPlank(len: number, thick: number, depth: number, radius: number, tile = 1.2): BufferGeometry {
  // one bevel segment: at eye level it reads as a rounded edge, at a third of the triangles
  const g = clean(new RoundedBoxGeometry(len, thick, depth, 1, radius));
  // planar UVs: u along the length, v across (top and bottom), so the grain follows the plank
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const across = Math.abs(nor.getY(i)) > 0.5 ? pos.getZ(i) : pos.getY(i);
    uv.setXY(i, x / tile, across / tile + 0.37);
  }
  return g;
}

/** A plane in a world rectangle, subdivided every `step` metres so baked light pools stay round. */
export function gridPlane(w: number, h: number, step: number, tile: number): BufferGeometry {
  const g = clean(new PlaneGeometry(w, h, Math.max(1, Math.round(w / step)), Math.max(1, Math.round(h / step))));
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
  return g;
}

export function cylinder(rTop: number, rBottom: number, h: number, seg = 12, open = false): BufferGeometry {
  return clean(new CylinderGeometry(rTop, rBottom, h, seg, 1, open));
}

/** A lathe profile ([radius, height] pairs, bottom to top) around y. */
export function lathe(points: [number, number][], seg = 16, tileU = 1, tileV = 1): BufferGeometry {
  const g = clean(new LatheGeometry(points.map(([r, y]) => new Vector2(r, y)), seg));
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * tileU, uv.getY(i) * tileV);
  return g;
}

/** A segment from a to b as a thin box (rails, stalks), `w` × `w` in section. */
export function beam(a: V3, b: V3, w: number, h = w): BufferGeometry {
  const va = new Vector3(...a);
  const vb = new Vector3(...b);
  const len = va.distanceTo(vb);
  const g = tiledBox(w, len, h, 0.5);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  g.applyMatrix4(new Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), q, new Vector3(1, 1, 1)));
  return g;
}

/** Collects geometries per material key and merges each key into one. */
export class Batch {
  private parts = new Map<string, BufferGeometry[]>();
  add(key: string, ...gs: BufferGeometry[]) {
    const list = this.parts.get(key) ?? [];
    list.push(...gs);
    this.parts.set(key, list);
  }
  keys() {
    return [...this.parts.keys()];
  }
  get(key: string) {
    return this.parts.get(key) ?? [];
  }
  merged(): Map<string, BufferGeometry> {
    const out = new Map<string, BufferGeometry>();
    for (const [k, gs] of this.parts) {
      const m = mergeGeometries(gs, false);
      if (m) {
        m.computeBoundingSphere();
        out.set(k, m);
      }
    }
    return out;
  }
}

/** a deterministic random stream: the same zone looks the same on every phone */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
