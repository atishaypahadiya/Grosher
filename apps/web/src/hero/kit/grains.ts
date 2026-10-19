// Real grains, in 3D, on the target's visible surface only: the lit bin's front behind its acrylic (a
// gravity bin), or the mound in its tub (a scoop bin). Low-poly solids (a lentil is a six-sided lens, a
// kidney bean ten triangles) at their real size, packed in a layer over the textured fill, each a shade
// apart. Capped by a triangle budget so the close-up gate holds whatever the grain.

import { BufferAttribute, BufferGeometry, Color, Euler, InstancedMesh, Matrix4, Quaternion, Vector3, type Material } from "three";
import { rng, type V3 } from "./geom.ts";
import type { GrainShape } from "../bulk/recipe.ts";

/** at most this many triangles of real grain in a close-up */
export const GRAIN_TRIANGLES = 40_000;

/** A flat solid in the x / y plane, facing +z, one unit across: a lens, an oval, a kidney, a long grain or a round one. */
function solid(kind: NonNullable<GrainShape["solid"]>): BufferGeometry {
  // an outline (unit length along x), fanned from a raised centre
  const pts: [number, number][] = [];
  const n = kind === "kidney" ? 10 : kind === "long" ? 6 : 6;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    let x = Math.cos(t) * 0.5;
    let y = Math.sin(t) * 0.5;
    if (kind === "kidney" && y > 0) y *= 0.55 + 0.45 * Math.abs(Math.cos(t)); // the bow on one side
    pts.push([x, y]);
    void x;
  }
  const dome = kind === "lens" ? 0.12 : kind === "round" ? 0.42 : kind === "long" ? 0.28 : 0.32;
  const pos: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    pos.push(0, 0, dome, a[0], a[1], 0, b[0], b[1], 0);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

export interface GrainLayer {
  /** where the grains go: a vertical face (centre, width, height, facing ±z) or a mound top (centre, w, d) */
  surface: { kind: "front"; center: V3; w: number; h: number; facing: 1 | -1 } | { kind: "top"; center: V3; w: number; d: number; height: (x: number, z: number) => number };
  shape: GrainShape;
  tint: V3;
}

/** One instanced mesh of real grains over a target's visible surface, or null for powders and flakes. */
export function grainLayer(layer: GrainLayer, material: Material, seed = 7): InstancedMesh | null {
  const { shape } = layer;
  if (!shape.solid) return null;
  const geo = solid(shape.solid);
  const tris = geo.getAttribute("position").count / 3;
  const [len, wid] = [shape.size[0] / 1000, shape.size[1] / 1000];
  const area = layer.surface.kind === "front" ? layer.surface.w * layer.surface.h : layer.surface.w * layer.surface.d;
  // a layer that covers the surface about once (the texture underneath fills what the gaps show)
  const want = Math.round((area / (len * wid * 0.78)) * 1.05);
  const count = Math.min(want, Math.floor(GRAIN_TRIANGLES / tris));
  const mesh = new InstancedMesh(geo, material, count);
  geo.setAttribute("color", new BufferAttribute(new Float32Array(geo.getAttribute("position").count * 3).fill(1), 3));
  const r = rng(seed);
  const m = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const c = new Color();
  for (let i = 0; i < count; i++) {
    const tilt = shape.solid === "lens" ? Math.acos(0.3 + 0.7 * r()) : r() * 0.5;
    const spin = r() * Math.PI * 2;
    const k = 0.85 + r() * 0.3;
    if (layer.surface.kind === "front") {
      const s = layer.surface;
      const x = s.center[0] + (r() - 0.5) * (s.w - len * 0.6);
      const y = s.center[1] + (r() - 0.5) * (s.h - len * 0.6);
      // pressed against the acrylic: face out, a little tilted, never through the wall
      e.set(tilt * (r() - 0.5), (s.facing === 1 ? 0 : Math.PI) + tilt * (r() - 0.5), spin);
      q.setFromEuler(e);
      m.compose(new Vector3(x, y, s.center[2] + s.facing * (0.0004 + r() * 0.0012)), q, new Vector3(len * k, wid * k, Math.min(len, wid) * k));
    } else {
      const s = layer.surface;
      const x = s.center[0] + (r() - 0.5) * s.w * 0.96;
      const z = s.center[2] + (r() - 0.5) * s.d * 0.96;
      const y = s.center[1] + s.height(x - s.center[0], z - s.center[2]);
      e.set(-Math.PI / 2 + tilt * (r() - 0.5), spin, 0, "YXZ");
      q.setFromEuler(e);
      m.compose(new Vector3(x, y + 0.0008, z), q, new Vector3(len * k, wid * k, Math.min(len, wid) * k));
    }
    mesh.setMatrixAt(i, m);
    const shade = 0.82 + r() * 0.3;
    mesh.setColorAt(i, c.setRGB(layer.tint[0] * shade, layer.tint[1] * shade, layer.tint[2] * shade));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = "hero-grains";
  return mesh;
}
