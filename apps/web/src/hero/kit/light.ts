// Per-pixel zone light: the track spots, the recessed downlights and any daylight a zone sees, evaluated in
// every kit material's fragment shader through three's own physical BRDF (RE_Direct), so pools have sharp
// edges and the polished concrete and the glass catch real highlights. Shadows are analytic: a zone lists
// its horizontal slabs (shelf planks, an island top) and a fragment is dark wherever the straight line to a
// light crosses one. No shadow maps, no extra passes, no extra draw calls; contact shadows under products,
// sacks and fixtures are decals (decals.ts). The ambient is the zone's one hemisphere light.
//
// The same maths runs in TypeScript (`lightAt`), so tests can check where the pools and shadows fall.

import { Vector3, Vector4, type Material, type WebGLProgramParametersWithUniforms } from "three";
import type { V3 } from "./geom.ts";

export interface ZoneLightDef {
  pos: V3;
  /** where the beam points */
  target: V3;
  /** half-angle of the beam, radians */
  angle: number;
  /** the soft part of the edge, as a fraction of the angle: small = a sharp pool */
  softness: number;
  /** linear colour times intensity */
  color: V3;
  /** metres beyond which the light is skipped (x and z), for speed */
  reach: number;
}

/** A horizontal slab that blocks light: a shelf plank (the whole run), an island top. */
export interface Slab {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
}

export interface LightRig {
  lights: ZoneLightDef[];
  slabs: Slab[];
  /** distance at which a light gives its full colour; inverse square beyond */
  reference: number;
  /** the half-width of a slab shadow's soft edge, metres (default 4 mm: crisp; daylight through a skylight's
   * mullions is softer) */
  soft?: number;
  /** a refrigerated case's lip lights (Produce's multideck): an LED strip under every shelf's front edge */
  cases?: CaseLight;
}

/**
 * LED strips under the front lip of each shelf of an open multideck: every point in the case below a strip
 * is lit from it, falling off with distance, brightest straight under it. The case is a box (x0–x1, from its
 * back zBack to zFront); each strip a height and the z of its lip.
 */
export interface CaseLight {
  x0: number;
  x1: number;
  zBack: number;
  zFront: number;
  strips: { y: number; z: number }[];
  color: V3;
  /** metres at which a strip has fallen to half */
  falloff: number;
}

/** a rig's program key: every number the shader is compiled with */
export const rigKey = (rig: LightRig) => `zone${rig.lights.length}-${rig.slabs.length}${rig.soft ? `-s${rig.soft}` : ""}${rig.cases ? `-c${rig.cases.strips.length}` : ""}`;

/** 3000 K, normalised: (255, 180, 107) */
export const WARM_3000K: V3 = [1.0, 0.706, 0.42];
/** daylight through a skylight, kept warm-white (DESIGN.md: no blue) */
export const DAYLIGHT: V3 = [1.0, 0.95, 0.88];

export const scaled = (c: V3, k: number): V3 => [c[0] * k, c[1] * k, c[2] * k];

/** The shader's uniforms for a rig: one object, shared by every material of the zone. */
export function rigUniforms(rig: LightRig) {
  const zl: Vector4[] = [];
  for (const l of rig.lights) {
    const d = new Vector3(l.target[0] - l.pos[0], l.target[1] - l.pos[1], l.target[2] - l.pos[2]).normalize();
    const outer = Math.cos(l.angle);
    const inner = Math.cos(l.angle * (1 - l.softness));
    zl.push(new Vector4(l.pos[0], l.pos[1], l.pos[2], outer), new Vector4(d.x, d.y, d.z, inner), new Vector4(l.color[0], l.color[1], l.color[2], l.reach));
  }
  const zs = rig.slabs.map((s) => new Vector4(s.x0, s.z0, s.x1, s.z1));
  const zsy = rig.slabs.map((s) => s.y);
  const c = rig.cases;
  return {
    uZL: { value: zl },
    uZS: { value: zs.length ? zs : [new Vector4()] },
    uZSY: { value: zsy.length ? zsy : [0] },
    uZC: { value: c ? new Vector4(c.x0, c.x1, c.zBack, c.zFront) : new Vector4() },
    uZCS: { value: c ? c.strips.map((t) => new Vector4(t.y, t.z, 0, 0)) : [new Vector4()] },
    uZCC: { value: c ? new Vector4(c.color[0], c.color[1], c.color[2], c.falloff) : new Vector4() },
  };
}
export type RigUniforms = ReturnType<typeof rigUniforms>;

const glsl = (rig: LightRig) => ({
  defines: `#define ZONE_LIGHTS ${rig.lights.length}\n#define ZONE_SLABS ${rig.slabs.length}\n#define ZONE_REF2 ${(rig.reference * rig.reference).toFixed(4)}\n#define ZONE_SOFT ${(rig.soft ?? 0.004).toFixed(4)}\n#define ZONE_CASE ${rig.cases?.strips.length ?? 0}\n`,
  pars: /* glsl */ `
    uniform vec4 uZL[ZONE_LIGHTS * 3];
    #if ZONE_CASE > 0
    uniform vec4 uZC;
    uniform vec4 uZCS[ZONE_CASE];
    uniform vec4 uZCC;
    #endif
    #if ZONE_SLABS > 0
    uniform vec4 uZS[ZONE_SLABS];
    uniform float uZSY[ZONE_SLABS];
    #endif
    varying vec3 vZoneWorld;
    float zoneShadow(vec3 p, vec3 l) {
      float s = 1.0;
      #if ZONE_SLABS > 0
      for (int k = 0; k < ZONE_SLABS; k++) {
        float y = uZSY[k];
        if ((p.y - y) * (l.y - y) >= 0.0) continue;
        vec2 h = mix(p.xz, l.xz, (y - p.y) / (l.y - p.y));
        vec4 r = uZS[k];
        // a soft edge (4 mm by default: crisp, never aliased)
        vec2 a = smoothstep(r.xy - ZONE_SOFT, r.xy + ZONE_SOFT, h) * (1.0 - smoothstep(r.zw - ZONE_SOFT, r.zw + ZONE_SOFT, h));
        s *= 1.0 - a.x * a.y;
      }
      #endif
      return s;
    }
  `,
  loop: /* glsl */ `
    for (int i = 0; i < ZONE_LIGHTS; i++) {
      vec4 la = uZL[i * 3];
      vec4 lb = uZL[i * 3 + 1];
      vec4 lc = uZL[i * 3 + 2];
      vec3 toL = la.xyz - vZoneWorld;
      if (abs(toL.x) > lc.w || abs(toL.z) > lc.w) continue;
      float d2 = dot(toL, toL);
      vec3 L = toL * inversesqrt(d2);
      float cone = smoothstep(la.w, lb.w, dot(-L, lb.xyz));
      if (cone <= 0.0) continue;
      float sh = zoneShadow(vZoneWorld, la.xyz);
      if (sh <= 0.0) continue;
      IncidentLight zl;
      zl.color = lc.rgb * cone * sh * (ZONE_REF2 / max(d2, ZONE_REF2 * 0.5));
      zl.direction = normalize((viewMatrix * vec4(L, 0.0)).xyz);
      zl.visible = true;
      RE_Direct(zl, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    }
    #if ZONE_CASE > 0
    // the case's lip lights: from the strip above, straight up over this point, falling off with distance
    if (vZoneWorld.x > uZC.x && vZoneWorld.x < uZC.y && vZoneWorld.z > uZC.z - 0.05 && vZoneWorld.z < uZC.w + 0.35) {
      for (int k = 0; k < ZONE_CASE; k++) {
        vec4 st = uZCS[k];
        float dy = st.x - vZoneWorld.y;
        if (dy <= 0.005 || dy > 0.7) continue;
        vec3 toL = vec3(0.0, dy, st.y - vZoneWorld.z);
        float d2 = dot(toL, toL);
        vec3 L = toL * inversesqrt(d2);
        IncidentLight cl;
        cl.color = uZCC.rgb * L.y * (uZCC.w * uZCC.w) / (uZCC.w * uZCC.w + d2);
        cl.direction = normalize((viewMatrix * vec4(L, 0.0)).xyz);
        cl.visible = true;
        RE_Direct(cl, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
      }
    }
    #endif
  `,
});

/** A shader patch: code a material's onBeforeCompile applies; patches compose (cells, strata, zone light). */
export type Patch = (shader: WebGLProgramParametersWithUniforms) => void;

/** The zone light as a patch on a MeshStandardMaterial's shader. */
export function zoneLightPatch(rig: LightRig, uniforms: RigUniforms): Patch {
  const g = glsl(rig);
  return (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vZoneWorld;`)
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec4 zoneW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          zoneW = instanceMatrix * zoneW;
        #endif
        vZoneWorld = (modelMatrix * zoneW).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${g.defines}${g.pars}`)
      .replace("#include <lights_fragment_end>", `${g.loop}\n#include <lights_fragment_end>`);
  };
}

/** Apply patches to a material (in order) and key its program on their names. */
export function withPatches<M extends Material>(m: M, key: string, ...patches: Patch[]): M {
  m.onBeforeCompile = (shader) => {
    for (const p of patches) p(shader);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

// ---------------------------------------------------------------- the same light, in TypeScript

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function shadowAt(rig: LightRig, p: V3, l: V3): number {
  let s = 1;
  const e = rig.soft ?? 0.004;
  for (const k of rig.slabs) {
    if ((p[1] - k.y) * (l[1] - k.y) >= 0) continue;
    const t = (k.y - p[1]) / (l[1] - p[1]);
    const hx = p[0] + (l[0] - p[0]) * t;
    const hz = p[2] + (l[2] - p[2]) * t;
    const a = smooth(k.x0 - e, k.x0 + e, hx) * (1 - smooth(k.x1 - e, k.x1 + e, hx));
    const b = smooth(k.z0 - e, k.z0 + e, hz) * (1 - smooth(k.z1 - e, k.z1 + e, hz));
    s *= 1 - a * b;
  }
  return s;
}

/** Diffuse irradiance (linear RGB, before the albedo) at a point with normal n: what the shader adds. */
export function lightAt(rig: LightRig, p: V3, n: V3): V3 {
  const out: V3 = [0, 0, 0];
  const ref2 = rig.reference * rig.reference;
  for (const l of rig.lights) {
    const to = [l.pos[0] - p[0], l.pos[1] - p[1], l.pos[2] - p[2]];
    if (Math.abs(to[0]) > l.reach || Math.abs(to[2]) > l.reach) continue;
    const d2 = to[0] ** 2 + to[1] ** 2 + to[2] ** 2;
    const d = Math.sqrt(d2);
    const L = to.map((c) => c / d);
    const dir = new Vector3(l.target[0] - l.pos[0], l.target[1] - l.pos[1], l.target[2] - l.pos[2]).normalize();
    const cone = smooth(Math.cos(l.angle), Math.cos(l.angle * (1 - l.softness)), -(L[0] * dir.x + L[1] * dir.y + L[2] * dir.z));
    const ndl = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
    if (cone <= 0 || ndl <= 0) continue;
    const e = cone * ndl * shadowAt(rig, p, l.pos) * (ref2 / Math.max(d2, ref2 * 0.5));
    for (let c = 0; c < 3; c++) out[c] += l.color[c] * e;
  }
  const cs = rig.cases;
  if (cs && p[0] > cs.x0 && p[0] < cs.x1 && p[2] > cs.zBack - 0.05 && p[2] < cs.zFront + 0.35)
    for (const st of cs.strips) {
      const dy = st.y - p[1];
      if (dy <= 0.005 || dy > 0.7) continue;
      const to = [0, dy, st.z - p[2]];
      const d2 = to[1] ** 2 + to[2] ** 2;
      const d = Math.sqrt(d2);
      const L = to.map((c) => c / d);
      const ndl = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
      const e = L[1] * ((cs.falloff * cs.falloff) / (cs.falloff * cs.falloff + d2)) * ndl;
      for (let c = 0; c < 3; c++) out[c] += cs.color[c] * e;
    }
  return out;
}
