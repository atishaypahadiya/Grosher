// Hero textures (KTX2 / Basis Universal, src/hero/assets, scripts/gen-hero-textures.mjs) and the kit's
// materials. Textures are transcoded on the device to its native GPU format (ASTC on iPhones, BC on desktops,
// ETC2 elsewhere) by three's KTX2Loader with the Basis transcoder served from /basis/. Two tiers: "hi" (the
// sizes in the manifest) and "lo" (half): weak devices, or a phone that cannot hold 30 fps, get lo.
//
// Every material is lit per pixel by the zone's lights (light.ts). Vertex or instance colours carry only a
// tint and the occlusion in corners; the light itself is never baked. Two more shader patches: `cells` maps
// a label's 0–1 UVs into its atlas cell (per vertex or per instance), `tiles` paints grain at its real size,
// mapped from the world (no stretching when a bin's fill is scaled) and layered on a bin's front.

import { Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, type Material, RepeatWrapping, SRGBColorSpace, type CompressedTexture, type Texture, type WebGLRenderer } from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { heroStats } from "../stats.ts";
import { load } from "../../lib/storage.ts";
import { GRAIN_COLS, GRAIN_ROWS } from "../bulk/recipe.ts";
import { rigUniforms, withPatches, zoneLightPatch, type LightRig, type Patch } from "./light.ts";

export type Tier = "hi" | "lo";
export const TEXTURES = ["pine", "plaster", "plaster_n", "concrete", "burlap", "burlap_n", "terracotta", "stone", "stone_n", "grains", "grains_n", "labels", "headers", "cutouts"] as const;
export type TextureName = (typeof TEXTURES)[number];
const ATLASES: TextureName[] = ["grains", "grains_n", "labels", "headers", "cutouts"];

// every file, by name, as a hashed asset URL (Vite globs the folder; the service worker precaches them)
const FILES = import.meta.glob("../assets/*.ktx2", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const urlOf = (name: string, tier: Tier) => FILES[`../assets/${name}${tier === "lo" ? ".lo" : ""}.ktx2`];

let loader: KTX2Loader | null = null;
function ktx2(gl: WebGLRenderer): KTX2Loader {
  if (!loader) {
    loader = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`).detectSupport(gl);
  }
  return loader;
}

/** GPU bytes of a transcoded texture: every mip level's data (compressed formats keep their block size). */
function gpuBytes(t: Texture): number {
  const mips = (t as CompressedTexture).mipmaps as { data: ArrayBufferView }[] | undefined;
  if (mips?.length) return mips.reduce((s, m) => s + (m.data?.byteLength ?? 0), 0);
  const img = t.image as { width?: number; height?: number } | undefined;
  return img?.width && img.height ? Math.round(img.width * img.height * 4 * 1.33) : 0;
}

/** the tier this phone fell back to once (a close-up ran under 30 fps on hi), kept for next time */
export const TIER_KEY = "grosher.heroTier";

/** ?tier=hi|lo pins the tier (the gate, a check by hand) */
export const pinnedTier = (): Tier | null => {
  if (typeof location === "undefined") return null;
  const q = new URLSearchParams(location.search).get("tier");
  return q === "lo" || q === "hi" ? q : null;
};

/** Pick a tier for this device: lo on low memory or few cores, after a slow close-up, or when asked (?tier=lo). */
export function pickTier(): Tier {
  const pinned = pinnedTier();
  if (pinned) return pinned;
  if (load<Tier | null>(TIER_KEY, null) === "lo") return "lo";
  const nav = (typeof navigator !== "undefined" ? navigator : {}) as Navigator & { deviceMemory?: number };
  if ((nav.deviceMemory ?? 8) <= 3 || (nav.hardwareConcurrency ?? 8) <= 4) return "lo";
  return "hi";
}

export async function loadHeroTextures(gl: WebGLRenderer, tier: Tier): Promise<Record<TextureName, Texture>> {
  const t0 = performance.now();
  const l = ktx2(gl);
  const entries = await Promise.all(
    TEXTURES.map(async (name) => {
      const t = await l.loadAsync(urlOf(name, tier));
      if (!ATLASES.includes(name)) t.wrapS = t.wrapT = RepeatWrapping;
      if (!name.endsWith("_n")) t.colorSpace = SRGBColorSpace;
      t.anisotropy = 4;
      t.needsUpdate = true;
      return [name, t] as const;
    }),
  );
  heroStats.tier = tier;
  heroStats.textures = entries.length;
  heroStats.gpuBytes = entries.reduce((s, [, t]) => s + gpuBytes(t), 0);
  heroStats.loadMs = Math.round(performance.now() - t0);
  return Object.fromEntries(entries) as unknown as Record<TextureName, Texture>;
}

/** Labels: `aCell` (u0, v0, du, dv), per vertex or per instance, remaps a pack's 0–1 UVs into its atlas cell. */
const cells: Patch = (shader) => {
  shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 aCell;").replace(
    "#include <uv_vertex>",
    `#include <uv_vertex>
    #ifdef USE_MAP
      vMapUv = aCell.xy + vMapUv * aCell.zw;
    #endif`,
  );
};

/**
 * Grain at its real size: `aGrain` (shape index, metres per cell) picks a cell of the grains atlas, which is
 * tiled over the surface from the world position along its main axis (a pile's top from above, a bin's front
 * from the front), sampled with explicit gradients so the wrap has no seam in the mips. On a bin's front and
 * sides the grain lies in layers against the acrylic: bands a couple of centimetres deep, each a shade apart.
 */
function tiles(map: Texture, normalMap: Texture): Patch {
  return (shader) => {
    shader.uniforms.uGrainMap = { value: map };
    shader.uniforms.uGrainN = { value: normalMap };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aGrain;\nvarying vec2 vGrain;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvGrain = aGrain;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uGrainMap;\nuniform sampler2D uGrainN;\nvarying vec2 vGrain;")
      .replace(
        "#include <map_fragment>",
        /* glsl */ `
        vec3 gFn = normalize(cross(dFdx(vZoneWorld), dFdy(vZoneWorld)));
        vec3 gA = abs(gFn);
        vec2 gP;
        vec3 gT;
        if (gA.y >= gA.x && gA.y >= gA.z) { gP = vZoneWorld.xz; gT = vec3(1.0, 0.0, 0.0); }
        else if (gA.x >= gA.z) { gP = vZoneWorld.zy; gT = vec3(0.0, 0.0, 1.0); }
        else { gP = vZoneWorld.xy; gT = vec3(1.0, 0.0, 0.0); }
        vec2 gTile = gP / vGrain.y;
        vec2 gF = fract(gTile);
        vec2 gCell = vec2(mod(vGrain.x, ${GRAIN_COLS.toFixed(1)}), floor(vGrain.x / ${GRAIN_COLS.toFixed(1)}));
        const float gIn = 2.0 / 256.0;
        vec2 gUV = vec2((gCell.x + gIn + gF.x * (1.0 - 2.0 * gIn)) / ${GRAIN_COLS.toFixed(1)}, (${(GRAIN_ROWS - 1).toFixed(1)} - gCell.y + gIn + gF.y * (1.0 - 2.0 * gIn)) / ${GRAIN_ROWS.toFixed(1)});
        vec2 gScale = vec2(1.0 / ${GRAIN_COLS.toFixed(1)}, 1.0 / ${GRAIN_ROWS.toFixed(1)}) * (1.0 - 2.0 * gIn);
        vec2 gdx = dFdx(gTile) * gScale;
        vec2 gdy = dFdy(gTile) * gScale;
        diffuseColor *= textureGrad(uGrainMap, gUV, gdx, gdy);
        if (gA.y < 0.6) {
          // layers: poured in batches, settled; a band every ~2.4 cm, wavering
          float gL = vZoneWorld.y * 26.0 + sin(vZoneWorld.x * 11.0 + vZoneWorld.z * 9.0) * 0.45 + sin(vZoneWorld.x * 31.0) * 0.08;
          float gBand = fract(gL);
          float gId = floor(gL);
          float gShade = 0.8 + 0.3 * fract(sin(gId * 12.9898) * 43758.5453);
          diffuseColor.rgb *= gShade * (0.82 + 0.18 * smoothstep(0.0, 0.12, gBand));
        }
        `,
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        {
          vec3 gn = textureGrad(uGrainN, gUV, gdx, gdy).xyz * 2.0 - 1.0;
          vec3 wN = inverseTransformDirection(normal, viewMatrix);
          vec3 T = normalize(gT - wN * dot(gT, wN));
          vec3 B = cross(wN, T);
          vec3 pw = normalize(T * gn.x + B * gn.y + wN * max(gn.z, 0.2));
          normal = normalize((viewMatrix * vec4(pw, 0.0)).xyz);
        }
        `,
      );
  };
}

/** The kit's materials, by key. Statics are merged meshes; bins and the target's grains are instanced. */
export type KitMaterials = Record<KitMaterialKey, Material>;
export type KitMaterialKey =
  | "plaster"
  | "ceiling"
  | "concrete"
  | "pine"
  | "steel"
  | "paint"
  | "copper"
  | "header"
  | "burlap"
  | "terracotta"
  | "stone"
  | "straw"
  | "cutout"
  | "label"
  | "glass"
  | "grain"
  | "lid"
  | "metal"
  | "produce"
  | "acrylic"
  | "binTrim"
  | "grainSolid"
  | "glow";

export function kitMaterials(t: Record<TextureName, Texture>, rig: LightRig, env?: Texture): KitMaterials {
  const uniforms = rigUniforms(rig);
  const zone = zoneLightPatch(rig, uniforms);
  const key = `zone${rig.lights.length}-${rig.slabs.length}`;
  // three keys a program on the material's parameters (maps, instancing, …) plus this: the patch set
  const std = (o: ConstructorParameters<typeof MeshStandardMaterial>[0], tag = "std", ...extra: Patch[]) => withPatches(new MeshStandardMaterial({ vertexColors: true, metalness: 0, ...o }), `${key}-${tag}`, zone, ...extra);
  return {
    plaster: std({ map: t.plaster, normalMap: t.plaster_n, roughness: 0.95 }),
    // the reference's ceiling is lit by what bounces off the shelves and floor: a little light of its own
    ceiling: std({ map: t.plaster, normalMap: t.plaster_n, color: new Color("#C8A684"), emissiveMap: t.plaster, emissive: new Color("#6E5642"), emissiveIntensity: 1, roughness: 1 }),
    // polished: a soft gloss from the room's baked environment (env.ts), the spots' highlights per pixel
    concrete: std({ map: t.concrete, roughness: 0.32, envMap: env, envMapIntensity: 0.55 }),
    pine: std({ map: t.pine, roughness: 0.66 }),
    // black steel, copper, paint, caps and tin lids: one mesh, each part's colour in its vertices (zone.ts)
    steel: std({ color: new Color("#FFFFFF"), roughness: 0.42 }),
    paint: std({ color: new Color("#CFC7BA"), roughness: 0.7 }),
    copper: std({ color: new Color("#C27A4A"), roughness: 0.3, metalness: 0.5 }),
    // header boards are lit signs: the white lettering carries a little light of its own
    header: std({ map: t.headers, emissiveMap: t.headers, emissive: new Color("#FFF4E6"), emissiveIntensity: 0.4, roughness: 0.8 }),
    burlap: std({ map: t.burlap, normalMap: t.burlap_n, roughness: 1 }),
    terracotta: std({ map: t.terracotta, roughness: 0.88 }),
    stone: std({ map: t.stone, normalMap: t.stone_n, roughness: 0.9 }),
    straw: std({ color: new Color("#E6CA8A"), roughness: 0.85, side: DoubleSide }),
    cutout: std({ map: t.cutouts, alphaTest: 0.5, side: DoubleSide, roughness: 0.9 }),
    label: std({ map: t.labels, roughness: 0.55 }, "cells", cells),
    glass: std({ color: new Color("#F6F6F2"), transparent: true, opacity: 0.2, roughness: 0.04, depthWrite: false, envMap: env, envMapIntensity: 0.5 }),
    grain: std({ roughness: 0.8 }, "tiles", tiles(t.grains, t.grains_n)),
    lid: std({ color: new Color("#FFFFFF"), roughness: 0.45 }),
    metal: std({ color: new Color("#FFFFFF"), roughness: 0.3, metalness: 0.35 }),
    produce: std({ color: new Color("#FFFFFF"), roughness: 0.6 }),
    acrylic: std({ color: new Color("#F4F6F2"), transparent: true, opacity: 0.07, roughness: 0.03, depthWrite: false, side: DoubleSide, envMap: env, envMapIntensity: 0.4 }),
    binTrim: std({ color: new Color("#262422"), roughness: 0.45 }),
    grainSolid: std({ color: new Color("#FFFFFF"), roughness: 0.5 }),
    // light sources seen directly: lenses, downlight discs, the skylight; their own colour, never tone-mapped
    glow: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  };
}
