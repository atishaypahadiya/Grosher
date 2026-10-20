// Fruit and vegetables one by one, as instances. Most kinds are one low-poly sphere that the vertex shader
// reshapes per instance (`fruitShape`): a stem hollow (apples, tomatoes, pumpkins), a pointed top or both ends
// (onions, lemons), lobes or ribs (peppers, pumpkins), lumps (potatoes, ginger), a neck (pears, butternut,
// avocados), a bend (mangoes, chilies); the fragment shader adds a second colour washed over one side (an
// apple's red), stripes (watermelon), the stem end's colour (a tomato's calyx), pores or netting as a bump
// (citrus, cantaloupe), and the roughness (a glossy apple, a matte onion). Normals come from the deformed
// surface by finite differences. Bananas, leafy heads and tied bunches have templates of their own, and
// punnets, tubs and bags are boxes with their contents from the packs atlas.
//
// `packCrate` is the packing pass: fruit sit on their pile's surface inside the crate, never through each
// other or the crate's sides, deterministic per crate.

import { BoxGeometry, BufferAttribute, BufferGeometry, Color, Matrix4, PlaneGeometry, Quaternion, SphereGeometry, Vector3, Euler } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { beam, clean, cylinder, lathe, place, rng, type V3 } from "../kit/geom.ts";
import type { Patch } from "../kit/light.ts";
import { hex } from "../kit/bake.ts";
import { KINDS, type Kind, type KindId } from "./recipe.ts";

// ---------------------------------------------------------------- the round template and its shader

/** the round template: a sphere of diameter 1 (the instance scales it to the kind's size), two levels */
export const roundGeometry = (hi: boolean) => clean(new SphereGeometry(0.5, hi ? 20 : 10, hi ? 14 : 7));
export const ROUND_TRIS = { lo: 120, hi: 520 };

/** per-instance shape attributes, in the order the shader reads them */
export interface Shape {
  a: [number, number, number, number]; // dimple, point, ribs, ribDepth
  b: [number, number, number, number]; // lump, neck, bend, rough
  c: [number, number, number, number]; // bumpAmp, bumpFreq, stripes, stripeDark
  blush: [number, number, number, number]; // linear rgb, amount (−: from below)
  pole: [number, number, number, number]; // linear rgb, size
}

export function shapeOf(k: Kind): Shape {
  const bl = k.blush ? hex(k.blush[0]) : [0, 0, 0];
  const po = k.pole ? hex(k.pole[0]) : [0, 0, 0];
  return {
    a: [k.dimple ?? 0, k.point ?? 0, k.ribs?.[0] ?? 0, k.ribs?.[1] ?? 0],
    b: [k.lump ?? 0, k.neck ?? 0, k.bend ?? 0, k.rough],
    c: [k.bumps?.[0] ?? 0, (k.bumps?.[1] ?? 0) * 0.5, k.stripes?.[0] ?? 0, k.stripes?.[1] ?? 0],
    blush: [bl[0], bl[1], bl[2], k.blush?.[1] ?? 0],
    pole: [po[0], po[1], po[2], k.pole?.[1] ?? 0],
  };
}

const NOISE = /* glsl */ `
  float fHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float fNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(fHash(i), fHash(i + vec3(1, 0, 0)), f.x), mix(fHash(i + vec3(0, 1, 0)), fHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(fHash(i + vec3(0, 0, 1)), fHash(i + vec3(1, 0, 1)), f.x), mix(fHash(i + vec3(0, 1, 1)), fHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
`;

/** The same deformation in TypeScript (tests, and the packing pass's sizes): the surface point for a unit direction. */
export function deform(d: V3, s: Shape, seed = 0): V3 {
  const [x, y, z] = d;
  const lon = Math.atan2(z, x);
  let rr = 0.5;
  const [dimple, point, ribs, ribDepth] = s.a;
  const [lump, neck, bend] = s.b;
  if (ribs > 0.5) rr *= 1 - ribDepth * Math.pow(0.5 - 0.5 * Math.cos(lon * ribs), 1.5) * (1 - Math.abs(y) ** 3);
  const lumpK = 1 + lump * (valueNoise([x * 2.3 + seed, y * 2.3 + seed, z * 2.3 + seed]) - 0.5) * 2;
  rr *= lumpK;
  const ny = neck >= 0 ? y : -y;
  rr *= 1 - Math.abs(neck) * smooth(-0.3, 0.9, ny);
  let py = y * 0.5 * lumpK;
  py -= Math.sign(y) * dimple * 0.5 * smooth(0.9, 1, Math.abs(y)) * (y > 0 ? 1 : 0.5);
  if (point >= 0) {
    const t = smooth(0.55, 1, y);
    py += point * 0.5 * t;
    rr *= 1 - 0.55 * point * t;
  } else {
    const t = smooth(0.55, 1, Math.abs(y));
    py += Math.sign(y) * -point * 0.5 * t;
    rr *= 1 + 0.55 * point * t;
  }
  return [x * rr + bend * (py * py * 4 - 0.25) * 0.5, py, z * rr];
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const fract = (v: number) => v - Math.floor(v);
/** the shader's value noise (fHash, fNoise), the same numbers */
function valueNoise(p: V3): number {
  const h = (q: V3) => {
    const [a, b, c] = q.map((v) => fract(v * 0.3183099 + 0.1) * 17);
    return fract(a * b * c * (a + b + c));
  };
  const i = p.map(Math.floor) as V3;
  const f = p.map((v, k) => v - i[k]).map((t) => t * t * (3 - 2 * t));
  const at = (dx: number, dy: number, dz: number) => h([i[0] + dx, i[1] + dy, i[2] + dz]);
  const lx = (dy: number, dz: number) => at(0, dy, dz) * (1 - f[0]) + at(1, dy, dz) * f[0];
  const ly = (dz: number) => lx(0, dz) * (1 - f[1]) + lx(1, dz) * f[1];
  return ly(0) * (1 - f[2]) + ly(1) * f[2];
}

/** The vertex and fragment patch that turns the round template into each kind (see `deform`). */
export const fruitShape: Patch = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      /* glsl */ `#include <common>
      attribute vec4 aShapeA;
      attribute vec4 aShapeB;
      attribute vec4 aShapeC;
      attribute vec4 aBlush;
      attribute vec4 aPole;
      varying vec3 vFDir;
      varying float vFSeed;
      varying vec4 vFC;
      varying vec4 vFBlush;
      varying vec4 vFPole;
      varying float vFRough;
      ${NOISE}
      vec3 fDeform(vec3 d, float seed) {
        float y = d.y;
        float lon = atan(d.z, d.x);
        float rr = 0.5;
        if (aShapeA.z > 0.5) rr *= 1.0 - aShapeA.w * pow(0.5 - 0.5 * cos(lon * aShapeA.z), 1.5) * (1.0 - pow(abs(y), 3.0));
        float lumpK = 1.0 + aShapeB.x * (fNoise(d * 2.3 + seed) - 0.5) * 2.0;
        rr *= lumpK;
        float ny = aShapeB.y >= 0.0 ? y : -y;
        rr *= 1.0 - abs(aShapeB.y) * smoothstep(-0.3, 0.9, ny);
        float py = y * 0.5 * lumpK;
        py -= sign(y) * aShapeA.x * 0.5 * smoothstep(0.9, 1.0, abs(y)) * (y > 0.0 ? 1.0 : 0.5);
        if (aShapeA.y >= 0.0) {
          float t = smoothstep(0.55, 1.0, y);
          py += aShapeA.y * 0.5 * t;
          rr *= 1.0 - 0.55 * aShapeA.y * t;
        } else {
          float t = smoothstep(0.55, 1.0, abs(y));
          py += sign(y) * -aShapeA.y * 0.5 * t;
          rr *= 1.0 + 0.55 * aShapeA.y * t;
        }
        return vec3(d.x * rr + aShapeB.z * (py * py * 4.0 - 0.25) * 0.5, py, d.z * rr);
      }`,
    )
    .replace(
      "#include <beginnormal_vertex>",
      /* glsl */ `
      vec3 fD = normalize(position);
      float fSeed = 0.0;
      #ifdef USE_INSTANCING
        fSeed = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 10.0;
      #endif
      vec3 fT1 = normalize(abs(fD.y) < 0.99 ? cross(vec3(0.0, 1.0, 0.0), fD) : vec3(1.0, 0.0, 0.0));
      vec3 fT2 = cross(fD, fT1);
      vec3 fP = fDeform(fD, fSeed);
      vec3 fP1 = fDeform(normalize(fD + fT1 * 0.03), fSeed);
      vec3 fP2 = fDeform(normalize(fD + fT2 * 0.03), fSeed);
      vec3 objectNormal = normalize(cross(fP1 - fP, fP2 - fP));
      if (dot(objectNormal, fD) < 0.0) objectNormal = -objectNormal;
      vFDir = fD;
      vFSeed = fSeed;
      vFC = aShapeC;
      vFBlush = aBlush;
      vFPole = aPole;
      vFRough = aShapeB.w;
      #ifdef USE_TANGENT
        vec3 objectTangent = vec3( tangent.xyz );
      #endif`,
    )
    .replace("#include <begin_vertex>", "vec3 transformed = fP;");
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      /* glsl */ `#include <common>
      varying vec3 vFDir;
      varying float vFSeed;
      varying vec4 vFC;
      varying vec4 vFBlush;
      varying vec4 vFPole;
      varying float vFRough;
      ${NOISE}`,
    )
    .replace(
      "#include <color_fragment>",
      /* glsl */ `#include <color_fragment>
      {
        vec3 d = normalize(vFDir);
        float lon = atan(d.z, d.x);
        // a second colour washed over the sun side (or from below), streaky
        float bm = vFBlush.w >= 0.0
          ? smoothstep(-0.7, 0.7, d.y * 0.6 + d.x * 0.5 + (fNoise(d * 2.0 + vFSeed) - 0.5) * 1.2)
          : smoothstep(0.1, -0.6, d.y + (fNoise(d * 3.0 + vFSeed) - 0.5) * 0.5);
        // streaked round it, from the stem down, as an apple's or a peach's blush is
        bm *= 0.5 + 0.85 * fNoise(vec3(d.x * 11.0, d.y * 1.6, d.z * 11.0) + vFSeed);
        diffuseColor.rgb = mix(diffuseColor.rgb, vFBlush.rgb, clamp(abs(vFBlush.w) * bm, 0.0, 1.0));
        // stripes round it (a watermelon's dark bands; negative lightens: a zucchini's flecks)
        if (vFC.z > 0.5) {
          float s = 0.5 + 0.5 * cos(lon * vFC.z + (fNoise(d * 4.0 + vFSeed) - 0.5) * 2.5);
          float k = smoothstep(0.35, 0.65, s) * (1.0 - smoothstep(0.85, 1.0, abs(d.y)));
          diffuseColor.rgb *= vFC.w >= 0.0 ? 1.0 - vFC.w * k : 1.0 + -vFC.w * k;
        }
        // the stem end: a calyx, a neck, a stem hollow's colour
        if (vFPole.w > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, vFPole.rgb, smoothstep(1.0 - vFPole.w, 1.0 - vFPole.w * 0.4, d.y));
        // and no two quite alike
        diffuseColor.rgb *= 0.9 + 0.2 * fNoise(d * 9.0 + vFSeed * 3.0);
      }`,
    )
    .replace("#include <roughnessmap_fragment>", "float roughnessFactor = vFRough;")
    .replace(
      "#include <normal_fragment_maps>",
      /* glsl */ `#include <normal_fragment_maps>
      if (vFC.x > 0.0) {
        // pores, netting: a height from noise on the skin, as a bump (derivatives), faded where it would alias
        vec3 q = vFDir * vFC.y;
        float fade = clamp(1.6 - length(fwidth(q)) * 1.2, 0.0, 1.0);
        float h = vFC.x * 0.0012 * fade * (fNoise(q) + 0.5 * fNoise(q * 2.1));
        vec3 sx = dFdx(-vViewPosition);
        vec3 sy = dFdy(-vViewPosition);
        vec3 r1 = cross(sy, normal);
        vec3 r2 = cross(normal, sx);
        float det = dot(sx, r1);
        vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
        normal = normalize(abs(det) * normal - grad);
      }`,
    );
};

// ---------------------------------------------------------------- the other templates

/** vertex colours on a world-space piece */
function painted(g: BufferGeometry, color: (p: Vector3, n: Vector3) => V3): BufferGeometry {
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const col = new Float32Array(pos.count * 3);
  const p = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    n.set(nor.getX(i), nor.getY(i), nor.getZ(i));
    col.set(color(p, n), i * 3);
  }
  g.setAttribute("color", new BufferAttribute(col, 3));
  return g;
}

/**
 * A bunch of bananas, lying with its crown at −x: five fingers fanned and curving up from the crown, each a
 * pentagonal tube tapering to a dark tip, green toward the stem. About 0.2 m long; the instance scales it.
 */
export function bananaBunch(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const N = 5;
  const R = 0.017;
  const L = 0.19;
  const RINGS = 8;
  const SIDES = 5;
  for (let f = 0; f < N; f++) {
    const fan = (f - (N - 1) / 2) * 0.24;
    const lift = Math.abs(f - (N - 1) / 2) * 0.006;
    const centre = (t: number): Vector3 => {
      const along = L * t;
      // outward from the crown, curving up
      return new Vector3(-0.09 + Math.cos(fan) * along, 0.02 + lift + 0.16 * along * along * 3.2, Math.sin(fan) * along);
    };
    const pos: number[] = [];
    const col: number[] = [];
    const rings: Vector3[][] = [];
    for (let k = 0; k <= RINGS; k++) {
      const t = k / RINGS;
      const c = centre(t);
      const ahead = centre(Math.min(1, t + 0.02)).sub(centre(Math.max(0, t - 0.02))).normalize();
      const side = new Vector3(0, 1, 0).cross(ahead).normalize();
      const up = ahead.clone().cross(side).normalize();
      const r = R * (t < 0.12 ? 0.45 + (t / 0.12) * 0.55 : t > 0.85 ? Math.max(0.25, 1 - (t - 0.85) / 0.15) : 1);
      rings.push(Array.from({ length: SIDES }, (_, s) => {
        const a = (s / SIDES) * Math.PI * 2;
        return c.clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r * 0.9);
      }));
    }
    const colorAt = (t: number): V3 => (t < 0.1 ? [0.45, 0.55, 0.25] : t > 0.95 ? [0.18, 0.14, 0.1] : t < 0.25 ? [0.85, 0.92, 0.6] : [1, 1, 1]);
    for (let k = 0; k < RINGS; k++)
      for (let s = 0; s < SIDES; s++) {
        const a = rings[k][s];
        const b = rings[k][(s + 1) % SIDES];
        const c = rings[k + 1][(s + 1) % SIDES];
        const d = rings[k + 1][s];
        for (const v of [a, d, c, a, c, b]) pos.push(v.x, v.y, v.z);
        const ca = colorAt(k / RINGS);
        const cb = colorAt((k + 1) / RINGS);
        for (const cc of [ca, cb, cb, ca, cb, ca]) col.push(...cc);
      }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
    g.computeVertexNormals();
    g.setAttribute("uv", new BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    parts.push(g);
  }
  // the crown: a short dark stub
  const crown = painted(place(cylinder(0.014, 0.018, 0.05, 6), { pos: [-0.105, 0.025, 0], rot: [0, 0, Math.PI / 2] }), () => [0.35, 0.36, 0.2]);
  parts.push(crown);
  return mergeGeometries(parts.map((p) => normalizeAttrs(p)))!;
}

/**
 * A leafy head (lettuce, cabbage): a core and two rings of cupped leaves curling out at the top, pale inside,
 * the tint's colour outside. Diameter 1, base at y 0; the instance scales it (romaine is tall and narrow).
 */
export function leafyHead(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const core = place(clean(new SphereGeometry(0.36, 6, 4)), { pos: [0, 0.4, 0], scale: [1, 1.05, 1] });
  parts.push(painted(core, () => [1.25, 1.3, 1.1]));
  const r = rng(17);
  for (const [ring, count, rad, h, open] of [
    [0, 6, 0.38, 0.86, 0.22],
    [1, 7, 0.46, 0.78, 0.45],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const a = ((i + ring * 0.5) / count) * Math.PI * 2 + r() * 0.2;
      const leaf = new PlaneGeometry(0.62, h, 4, 3);
      const pos = leaf.getAttribute("position");
      for (let k = 0; k < pos.count; k++) {
        const u = pos.getX(k) / 0.62; // −0.5 … 0.5 across
        const v = pos.getY(k) / h + 0.5; // 0 base … 1 top
        // cupped round the core, curling out at the top, a wavy edge
        const cup = Math.cos(u * Math.PI) * 0.14;
        // frilled toward the edge, more at the top
        const out = rad + open * v * v + Math.sin(u * 14 + i * 1.7) * 0.035 * v * v;
        const ang = a + u * 1.2;
        pos.setXYZ(k, Math.cos(ang) * (out - cup), v * h, Math.sin(ang) * (out - cup));
      }
      leaf.computeVertexNormals();
      parts.push(painted(clean(leaf), (p) => {
        const v = p.y / h;
        const k = ring === 0 ? 1.15 : 0.95;
        return [k * (0.85 + 0.25 * v), k * (0.92 + 0.15 * v), k * (0.8 + 0.2 * v)];
      }));
    }
  }
  return mergeGeometries(parts.map((p) => normalizeAttrs(p)))!;
}

/** A tied bunch's stems (herbs, kale, spring onions): green stems gathered by a twine band. Height 1, base y 0. */
export function bunchStems(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const r = rng(29);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const base = new Vector3(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.05);
    const tie = new Vector3(Math.cos(a) * 0.03, 0.22, Math.sin(a) * 0.025);
    const top = new Vector3(Math.cos(a + r()) * 0.2, 0.46 + r() * 0.08, Math.sin(a + r()) * 0.1);
    parts.push(painted(beam([base.x, base.y, base.z], [tie.x, tie.y, tie.z], 0.022), () => [0.16, 0.34, 0.08]));
    parts.push(painted(beam([tie.x, tie.y, tie.z], [top.x, top.y, top.z], 0.018), () => [0.14, 0.32, 0.07]));
  }
  // the twine
  parts.push(painted(place(cylinder(0.065, 0.065, 0.045, 10, true), { pos: [0, 0.2, 0] }), () => [0.6, 0.46, 0.28]));
  return mergeGeometries(parts.map((p) => normalizeAttrs(p)))!;
}

/** A tied bunch's leaves: four crossed cards over the stems (the foliage atlas cell per instance). */
export function bunchLeaves(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  // the leaves are most of a bunch: from the twine up, fuller than the stems
  for (let i = 0; i < 4; i++) {
    const card = clean(new PlaneGeometry(0.95, 0.82));
    place(card, { pos: [0, 0.58, 0], rot: [i % 2 ? 0.25 : -0.2, (i * Math.PI) / 4, 0] });
    parts.push(card);
  }
  return mergeGeometries(parts)!;
}

/** A pack, unit size: its clear plastic and its contents (both faces that show take the packs cell). */
export function packParts(): { clear: BufferGeometry; content: BufferGeometry } {
  const clear = clean(new BoxGeometry(1, 1, 1));
  place(clear, { pos: [0, 0.5, 0] });
  const content = clean(new BoxGeometry(0.96, 0.9, 0.96));
  place(content, { pos: [0, 0.46, 0] });
  return { clear, content };
}

/** A salad kit's bag or a bag of grapes: a pillow, its print or contents on the front and back. */
export function bag(): BufferGeometry {
  const g = clean(new BoxGeometry(1, 1, 1, 4, 6, 1));
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * 2;
    const y = pos.getY(i) * 2;
    const z = pos.getZ(i);
    const puff = Math.cos((x * Math.PI) / 2) * Math.cos((y * Math.PI) / 2.2);
    pos.setXYZ(i, pos.getX(i), pos.getY(i) + 0.5, z * (0.25 + 0.75 * puff));
  }
  g.computeVertexNormals();
  return g;
}

/** A juice bottle, 0.3 L: the glass, the juice, a ribbed metal cap, the label band (white, its code and name). */
export function bottleParts(): { glass: BufferGeometry; body: BufferGeometry; cap: BufferGeometry; label: BufferGeometry } {
  const profile: [number, number][] = [
    [0, 0],
    [0.031, 0],
    [0.033, 0.006],
    [0.033, 0.13],
    [0.028, 0.16],
    [0.014, 0.185],
    [0.014, 0.2],
  ];
  const glass = lathe(profile, 14);
  const liquid = lathe(
    profile.slice(0, 5).map(([r, y]) => [Math.max(0, r - 0.003), Math.min(y, 0.15) + 0.002] as [number, number]),
    12,
  );
  painted(liquid, () => [1, 1, 1]);
  // the cap: a short ribbed steel cylinder, its top a shade brighter
  const cap = cylinder(0.0165, 0.0165, 0.02, 16);
  const cp = cap.getAttribute("position");
  for (let i = 0; i < cp.count; i++) {
    const a = Math.atan2(cp.getZ(i), cp.getX(i));
    const k = Math.abs(cp.getY(i)) < 0.0099 ? 1 + 0.06 * Math.max(0, Math.cos(a * 8)) : 1;
    cp.setXYZ(i, cp.getX(i) * k, cp.getY(i), cp.getZ(i) * k);
  }
  cap.computeVertexNormals();
  place(cap, { pos: [0, 0.208, 0] });
  painted(cap, (_, n) => (n.y > 0.5 ? [0.86, 0.86, 0.84] : [0.74, 0.74, 0.72]));
  const body = normalizeAttrs(liquid);
  // the label: a band round the front, white with its number
  const label = cylinder(0.0335, 0.0335, 0.07, 14, true);
  place(label, { pos: [0, 0.07, 0] });
  const p = label.getAttribute("position");
  const uv = label.getAttribute("uv");
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getX(i), p.getZ(i));
    uv.setXY(i, Math.max(0, Math.min(1, 0.5 + a / Math.PI)), (p.getY(i) - 0.035) / 0.07);
  }
  return { glass, body, cap: normalizeAttrs(cap), label };
}

/** position, normal, uv and colour on every part, so they merge */
function normalizeAttrs(g: BufferGeometry): BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  const count = n.getAttribute("position").count;
  if (!n.getAttribute("uv")) n.setAttribute("uv", new BufferAttribute(new Float32Array(count * 2), 2));
  if (!n.getAttribute("color")) n.setAttribute("color", new BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  if (!n.getAttribute("normal")) n.computeVertexNormals();
  for (const name of Object.keys(n.attributes)) if (!["position", "normal", "uv", "color"].includes(name)) n.deleteAttribute(name);
  return n;
}

// ---------------------------------------------------------------- packing

/** A crate's pile, in the crate's own frame: x across, z front (−) to back (+), y up from the crate's floor. */
export interface Pile {
  w: number;
  d: number;
  /** the pile's surface height above the crate's floor at (x, z) */
  height: (x: number, z: number) => number;
}

export interface Placed {
  /** centre, in the crate's frame */
  pos: V3;
  rot: V3;
  /** the instance's scale: the kind's size times its own variation */
  size: V3;
  /** its footprint (x, z) and height as it lies in the crate */
  foot: V3;
  color: V3;
}

/**
 * The top layer of a crate: fruit dropped onto the pile's surface where there is room, front to back on a
 * jittered grid, each kept only if it overlaps none already placed and stays inside the crate's walls; it
 * settles a third of its height into the pile (fruit sit in a pile, not on a table). Deterministic per seed.
 */
export function packCrate(kindId: KindId, pile: Pile, seed: number, max = 80): Placed[] {
  const k = KINDS[kindId];
  const r = rng(seed);
  const base = k.colors.map(hex);
  const out: Placed[] = [];
  // lying fruit (long ones) lie along x, round ones stand
  const long = k.size[1] > Math.max(k.size[0], k.size[2]) * 1.5;
  const step = Math.max(k.size[0], long ? k.size[1] : k.size[0]) * 0.92;
  const stepZ = Math.max(k.size[2], k.size[0]) * 0.92;
  for (let gz = -pile.d / 2 + stepZ / 2; gz < pile.d / 2 && out.length < max; gz += stepZ)
    for (let gx = -pile.w / 2 + step / 2; gx < pile.w / 2 && out.length < max; gx += step) {
      const v = 0.88 + r() * 0.24;
      const size: V3 = [k.size[0] * v, k.size[1] * v * (0.94 + r() * 0.12), k.size[2] * v];
      const foot: V3 = long ? [size[1], size[0], size[2]] : size; // its footprint and height as it lies
      const x = gx + (r() - 0.5) * step * 0.35;
      const z = gz + (r() - 0.5) * stepZ * 0.35;
      const rx = foot[0] / 2;
      const rz = foot[2] / 2;
      if (Math.abs(x) + rx > pile.w / 2 || Math.abs(z) + rz > pile.d / 2) continue;
      const y = pile.height(x, z) + foot[1] * 0.5 - foot[1] * 0.33;
      // round ones overlap as circles, long ones (lying side by side along x) as their footprints
      const hits = (o: Placed) =>
        long
          ? Math.abs(o.pos[0] - x) < ((o.foot[0] + foot[0]) / 2) * 0.97 && Math.abs(o.pos[2] - z) < ((o.foot[2] + foot[2]) / 2) * 0.97
          : Math.hypot(o.pos[0] - x, o.pos[2] - z) < ((Math.min(o.foot[0], o.foot[2]) + Math.min(foot[0], foot[2])) / 2) * 0.98;
      if (out.some(hits)) continue;
      const c = base[Math.floor(r() * base.length)];
      const shade = 0.88 + r() * 0.24;
      const tint: V3 = [c[0] * shade * (0.95 + r() * 0.1), c[1] * shade * (0.95 + r() * 0.1), c[2] * shade * (0.95 + r() * 0.1)];
      // round fruit sit any way up, a little tipped; long ones lie along the crate
      const rot: V3 = long ? [0, (r() - 0.5) * 0.5, Math.PI / 2 + (r() - 0.5) * 0.2] : [(r() - 0.5) * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.5];
      out.push({ pos: [x, y, z], rot, size, foot, color: tint });
    }
  return out;
}

/** a placed fruit's world matrix, from its crate's frame */
export function fruitMatrix(crate: Matrix4, p: Placed): Matrix4 {
  const local = new Matrix4().compose(new Vector3(...p.pos), new Quaternion().setFromEuler(new Euler(...p.rot)), new Vector3(...p.size));
  return crate.clone().multiply(local);
}

export const linear = (c: V3) => new Color(c[0], c[1], c[2]);
