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
import { heroStats, trackTexture } from "../stats.ts";
import { load } from "../../lib/storage.ts";
import { GRAIN_COLS, GRAIN_ROWS } from "../bulk/recipe.ts";
import { rigKey, rigUniforms, withPatches, zoneLightPatch, type LightRig, type Patch } from "./light.ts";

export type Tier = "hi" | "lo";
export const TEXTURES = ["pine", "plaster", "plaster_n", "concrete", "burlap", "burlap_n", "terracotta", "stone", "stone_n", "grains", "grains_n", "labels", "headers", "cutouts"] as const;
export type TextureName = (typeof TEXTURES)[number];
/** what a standard close-up uses (src/hero/standard): the kit's wood, plaster and floor, the grains for loose
 * goods, every category's house label and the aisle signs */
export const STANDARD_TEXTURES = ["pine", "plaster", "concrete", "grains", "grains_n", "catlabels", "signs"] as const;
export type StandardTextureName = (typeof STANDARD_TEXTURES)[number];
/** Produce (src/hero/produce): the wood floor, brushed stainless, the kit's pine for the crates, and four
 * atlases of its own: chalkboards with juice labels and header boards, what shows in a tub or a punnet, fruit
 * piles at their real size, and leaves (herbs, plants, flowers) */
export const PRODUCE_TEXTURES = ["oak", "brushed", "pine", "chalk", "packs", "mounds", "foliage"] as const;
export type ProduceTextureName = (typeof PRODUCE_TEXTURES)[number];
type AnyTexture = TextureName | StandardTextureName | ProduceTextureName;
const ATLASES: AnyTexture[] = ["grains", "grains_n", "labels", "headers", "cutouts", "catlabels", "signs", "chalk", "packs", "mounds", "foliage"];
export type TextureSet = "bulk" | "standard" | "produce";
const SET_NAMES: Record<TextureSet, readonly AnyTexture[]> = { bulk: TEXTURES, standard: STANDARD_TEXTURES, produce: PRODUCE_TEXTURES };
type SetTextures = { bulk: Record<TextureName, Texture>; standard: Record<StandardTextureName, Texture>; produce: Record<ProduceTextureName, Texture> };

// every file, by name, as a hashed asset URL (Vite globs the folder; the service worker precaches them)
const FILES = import.meta.glob("../assets/*.ktx2", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const urlOf = (name: string, tier: Tier) => FILES[`../assets/${name}${tier === "lo" ? ".lo" : ""}.ktx2`];

let loader: KTX2Loader | null = null;
/**
 * The loader, configured for this device's compressed formats: from the trip's renderer, or (prepared ahead,
 * on the list screen, before any 3D canvas exists) from a throwaway WebGL2 probe on the same GPU.
 */
function ktx2(gl?: WebGLRenderer): KTX2Loader | null {
  if (loader) return loader;
  let renderer: WebGLRenderer | null = gl ?? null;
  if (!renderer) {
    const probe = typeof document !== "undefined" ? document.createElement("canvas").getContext("webgl2") : null;
    if (!probe) return null;
    const names = ["WEBGL_compressed_texture_astc", "WEBGL_compressed_texture_etc1", "WEBGL_compressed_texture_etc", "WEBGL_compressed_texture_s3tc", "EXT_texture_compression_bptc", "WEBGL_compressed_texture_pvrtc", "WEBKIT_WEBGL_compressed_texture_pvrtc"];
    const has = new Set(names.filter((n) => !!probe.getExtension(n)));
    const astc = probe.getExtension("WEBGL_compressed_texture_astc") as { getSupportedProfiles?: () => string[] } | null;
    const profiles = astc?.getSupportedProfiles?.() ?? [];
    (probe.getExtension("WEBGL_lose_context") as { loseContext?: () => void } | null)?.loseContext?.();
    renderer = { extensions: { has: (n: string) => has.has(n), get: (n: string) => (n === "WEBGL_compressed_texture_astc" ? { getSupportedProfiles: () => profiles } : null) } } as unknown as WebGLRenderer;
  }
  loader = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`).detectSupport(renderer);
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

async function fetchTextures<S extends TextureSet = "bulk">(l: KTX2Loader, tier: Tier, set: S = "bulk" as S): Promise<SetTextures[S]> {
  const entries = await Promise.all(
    SET_NAMES[set].map(async (name) => {
      const t = await l.loadAsync(urlOf(name, tier));
      if (!ATLASES.includes(name)) t.wrapS = t.wrapT = RepeatWrapping;
      if (!name.endsWith("_n")) t.colorSpace = SRGBColorSpace;
      t.anisotropy = 4;
      t.needsUpdate = true;
      trackTexture(t, gpuBytes(t));
      return [name, t] as const;
    }),
  );
  return Object.fromEntries(entries) as unknown as SetTextures[S];
}

/** textures fetched and transcoded ahead (prepareHeroTextures), by set and tier, waiting for the zone to take them */
const prepared = new Map<string, Promise<unknown>>();

/** Fetch and transcode a hero zone's textures now, before any 3D canvas exists (the list screen, idle time). */
export function prepareHeroTextures<S extends "bulk" | "produce" = "bulk">(tier: Tier, set: S = "bulk" as S): Promise<SetTextures[S] | null> {
  const key = `${set}:${tier}`;
  let p = prepared.get(key) as Promise<SetTextures[S] | null> | undefined;
  if (!p) {
    const l = ktx2();
    p = l ? fetchTextures(l, tier, set).catch(() => null) : Promise.resolve(null);
    prepared.set(key, p);
  }
  return p;
}

/**
 * The standard close-ups' textures: fetched and transcoded once per tier and kept for the trip (a trip opens a
 * dozen standard close-ups; they all share these, as they share their shader programs). ~1.2 MB on the wire on
 * hi. Their GPU copies are held only while a standard zone is uploaded (`holdStandardGpu`): leaving the last
 * one frees them, and the next standard zone uploads them again from the transcoded data, in its warm-up.
 */
const standardSet = new Map<Tier, Promise<Record<StandardTextureName, Texture>>>();
const standardLoaded = new Set<Record<StandardTextureName, Texture>>();
let standardOnGpu = 0;
/** A standard zone is on the GPU: its shared textures stay there until every holder has let go. */
export function holdStandardGpu(): () => void {
  standardOnGpu++;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    if (--standardOnGpu > 0) return;
    // the GPU copies only: three uploads a disposed texture again on its next use
    for (const set of standardLoaded) for (const t of Object.values(set)) t.dispose();
  };
}
export function standardTextures(tier: Tier, gl?: WebGLRenderer): Promise<Record<StandardTextureName, Texture>> {
  let p = standardSet.get(tier);
  if (!p) {
    const l = ktx2(gl);
    if (!l) return Promise.reject(new Error("no compressed texture support"));
    const t0 = performance.now();
    p = fetchTextures(l, tier, "standard").then((t) => {
      heroStats.loadMs = Math.round(performance.now() - t0);
      standardLoaded.add(t);
      return t;
    });
    p.catch(() => standardSet.delete(tier));
    standardSet.set(tier, p);
  }
  return p.then((t) => {
    heroStats.tier = tier;
    return t;
  });
}

/** Drop what was prepared and not taken (the route changed): the transcoded data goes with it. */
export function dropPreparedTextures(set?: "bulk" | "produce") {
  for (const [key, p] of prepared) {
    if (set && !key.startsWith(`${set}:`)) continue;
    p.then((t) => t && Object.values(t as Record<string, Texture>).forEach((x) => x.dispose()));
    prepared.delete(key);
  }
}

export async function loadHeroTextures<S extends "bulk" | "produce" = "bulk">(gl: WebGLRenderer, tier: Tier, set: S = "bulk" as S): Promise<SetTextures[S]> {
  const t0 = performance.now();
  // prepared ahead: take them (they are this zone's now; a later close-up loads its own)
  const key = `${set}:${tier}`;
  const ahead = prepared.get(key) as Promise<SetTextures[S] | null> | undefined;
  prepared.delete(key);
  const t = (ahead && (await ahead)) || (await fetchTextures(ktx2(gl)!, tier, set));
  heroStats.tier = tier;
  heroStats.loadMs = Math.round(performance.now() - t0);
  return t;
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
function tiles(map: Texture, normalMap: Texture | null, layers = true): Patch {
  return (shader) => {
    shader.uniforms.uGrainMap = { value: map };
    if (normalMap) shader.uniforms.uGrainN = { value: normalMap };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aGrain;\nvarying vec2 vGrain;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvGrain = aGrain;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform sampler2D uGrainMap;\n${normalMap ? "uniform sampler2D uGrainN;" : ""}\nvarying vec2 vGrain;`)
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
        if (${layers ? "true" : "false"} && gA.y < 0.6) {
          // layers: poured in batches, settled; a band every ~2.4 cm, wavering
          float gL = vZoneWorld.y * 26.0 + sin(vZoneWorld.x * 11.0 + vZoneWorld.z * 9.0) * 0.45 + sin(vZoneWorld.x * 31.0) * 0.08;
          float gBand = fract(gL);
          float gId = floor(gL);
          float gShade = 0.8 + 0.3 * fract(sin(gId * 12.9898) * 43758.5453);
          diffuseColor.rgb *= gShade * (0.82 + 0.18 * smoothstep(0.0, 0.12, gBand));
        }
        `,
      );
    if (normalMap)
      shader.fragmentShader = shader.fragmentShader.replace(
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

/**
 * A standard close-up's materials: the kit's, on the standard textures (the category labels for packs, the
 * aisle signs on the header boards). Every standard zone has the same number of lights and slabs, so these
 * programs compile once a trip.
 */
export function standardMaterials(t: Record<StandardTextureName, Texture>, rig: LightRig, env?: Texture): Partial<KitMaterials> {
  const uniforms = rigUniforms(rig);
  const zone = zoneLightPatch(rig, uniforms);
  const key = rigKey(rig);
  const std = (o: ConstructorParameters<typeof MeshStandardMaterial>[0], tag = "std", ...extra: Patch[]) => withPatches(new MeshStandardMaterial({ vertexColors: true, metalness: 0, ...o }), `${key}-${tag}`, zone, ...extra);
  return {
    plaster: std({ map: t.plaster, roughness: 0.95 }),
    concrete: std({ map: t.concrete, roughness: 0.32, envMap: env, envMapIntensity: 0.55 }),
    pine: std({ map: t.pine, roughness: 0.66 }),
    steel: std({ color: new Color("#FFFFFF"), roughness: 0.42 }),
    paint: std({ color: new Color("#FFFFFF"), roughness: 0.55 }),
    header: std({ map: t.signs, emissiveMap: t.signs, emissive: new Color("#FFF4E6"), emissiveIntensity: 0.45, roughness: 0.8 }),
    label: std({ map: t.catlabels, roughness: 0.5 }, "cells", cells),
    glass: std({ color: new Color("#F6F6F2"), transparent: true, opacity: 0.16, roughness: 0.04, depthWrite: false, envMap: env, envMapIntensity: 0.6 }),
    grain: std({ roughness: 0.75 }, "tiles", tiles(t.grains, t.grains_n)),
    lid: std({ color: new Color("#FFFFFF"), roughness: 0.45 }),
    metal: std({ color: new Color("#FFFFFF"), roughness: 0.28, metalness: 0.45, envMap: env, envMapIntensity: 0.5 }),
    glow: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
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
  const key = rigKey(rig);
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

/**
 * Rows: a cell of an atlas repeated across a face (`aRep` times along u and v, per instance): a far deck's front,
 * a row of tubs or bottles from one cell. Sampled with the unwrapped coordinates' gradients, so the repeats have
 * no seam in the mips.
 */
const rowCells: Patch = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute vec4 aCell;\nattribute vec2 aRep;\nvarying vec4 vCell;\nvarying vec2 vRepUv;")
    .replace("#include <uv_vertex>", "#include <uv_vertex>\nvCell = aCell;\n#ifdef USE_MAP\nvRepUv = vMapUv * aRep;\n#endif");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying vec4 vCell;\nvarying vec2 vRepUv;")
    .replace(
      "#include <map_fragment>",
      `#ifdef USE_MAP
        vec2 rUv = vCell.xy + fract(vRepUv) * vCell.zw;
        diffuseColor *= textureGrad(map, rUv, dFdx(vRepUv) * vCell.zw, dFdy(vRepUv) * vCell.zw);
      #endif`,
    );
};

/** Produce's materials, by key (src/hero/produce). Statics are merged per key; the crates, piles, fruit,
 * heads, bunches, packs and bottles are instanced. */
export type ProduceMaterialKey =
  | "oak"
  | "steel"
  | "paint"
  | "stainless"
  | "glow"
  | "chalk"
  | "chalkCell"
  | "pine"
  | "mound"
  | "fruit"
  | "plain"
  | "foliage"
  | "foliageCell"
  | "packs"
  | "packsRow"
  | "clear";
export type ProduceMaterials = Record<ProduceMaterialKey, Material>;

export function produceMaterials(t: Record<ProduceTextureName, Texture>, rig: LightRig, env: Texture | undefined, fruitShape: Patch): ProduceMaterials {
  const uniforms = rigUniforms(rig);
  const zone = zoneLightPatch(rig, uniforms);
  const key = rigKey(rig);
  const std = (o: ConstructorParameters<typeof MeshStandardMaterial>[0], tag = "std", ...extra: Patch[]) => withPatches(new MeshStandardMaterial({ vertexColors: true, metalness: 0, ...o }), `${key}-${tag}`, zone, ...extra);
  return {
    // oiled oak planks: a soft sheen from the room, the daylight's highlights per pixel
    oak: std({ map: t.oak, roughness: 0.48, envMap: env, envMapIntensity: 0.35 }),
    // black steel stands and frames, and every plain painted part: one mesh, colour in the vertices
    steel: std({ color: new Color("#FFFFFF"), roughness: 0.45 }),
    paint: std({ color: new Color("#FFFFFF"), roughness: 0.85 }),
    // the multideck, its canopy and the wall cladding: brushed stainless that catches the room
    stainless: std({ map: t.brushed, roughness: 0.3, metalness: 0.55, envMap: env, envMapIntensity: 0.6 }),
    glow: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    chalk: std({ map: t.chalk, roughness: 0.9 }),
    chalkCell: std({ map: t.chalk, roughness: 0.6 }, "cells", cells),
    pine: std({ map: t.pine, roughness: 0.7 }),
    mound: std({ roughness: 0.92 }, "tiles", tiles(t.mounds, null, false)),
    // fruit: the round template reshaped per instance (src/hero/produce/fruit.ts); its colour per instance
    fruit: withPatches(new MeshStandardMaterial({ color: new Color("#FFFFFF"), metalness: 0, roughness: 0.5 }), `${key}-fruit`, zone, fruitShape),
    plain: std({ roughness: 0.55 }),
    foliage: std({ map: t.foliage, alphaTest: 0.5, side: DoubleSide, roughness: 0.6 }),
    foliageCell: std({ map: t.foliage, alphaTest: 0.5, side: DoubleSide, roughness: 0.6 }, "cells", cells),
    packs: std({ map: t.packs, roughness: 0.5 }, "cells", cells),
    packsRow: std({ map: t.packs, roughness: 0.55 }, "rows", rowCells),
    clear: std({ color: new Color("#F6F8F4"), transparent: true, opacity: 0.05, roughness: 0.06, depthWrite: false, envMap: env, envMapIntensity: 0.12 }),
  };
}
