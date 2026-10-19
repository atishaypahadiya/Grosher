// Hero textures (KTX2 / Basis Universal, src/hero/assets, scripts/gen-hero-textures.mjs) and the kit's
// materials. Textures are transcoded on the device to its native GPU format (ASTC on iPhones, BC on desktops,
// ETC2 elsewhere) by three's KTX2Loader with the Basis transcoder served from /basis/. Two tiers: "hi" (the
// sizes in the manifest) and "lo" (half): weak devices, or a phone that cannot hold 30 fps, get lo.

import { Color, DoubleSide, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, type CompressedTexture, type Texture, type WebGLRenderer } from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

export type Tier = "hi" | "lo";
export const TEXTURES = ["pine", "plaster", "plaster_n", "concrete", "burlap", "burlap_n", "terracotta", "stone", "grains", "grains_n", "labels", "headers"] as const;
export type TextureName = (typeof TEXTURES)[number];

// every file, by name, as a hashed asset URL (Vite globs the folder; the service worker precaches them)
const FILES = import.meta.glob("../assets/*.ktx2", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const urlOf = (name: string, tier: Tier) => FILES[`../assets/${name}${tier === "lo" ? ".lo" : ""}.ktx2`];

import { heroStats } from "../stats.ts";
import { load } from "../../lib/storage.ts";

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
      t.wrapS = t.wrapT = name === "grains" || name === "grains_n" || name === "labels" || name === "headers" ? t.wrapS : RepeatWrapping;
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

/**
 * Per-instance atlas cells: `aCell` (u0, v0, du, dv) remaps the template's 0–1 UVs into one cell of the
 * atlas, for the colour map and the normal map alike. One program for all instanced kit meshes.
 */
function withCells(m: MeshStandardMaterial): MeshStandardMaterial {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 aCell;").replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>
      #ifdef USE_MAP
        vMapUv = aCell.xy + vMapUv * aCell.zw;
      #endif
      #ifdef USE_NORMALMAP
        vNormalMapUv = aCell.xy + vNormalMapUv * aCell.zw;
      #endif`,
    );
  };
  m.customProgramCacheKey = () => `grosher-cells-${m.normalMap ? "n" : ""}`;
  return m;
}

export interface KitMaterials {
  /** merged static meshes, by kit material key; colour = baked light (vertex colours) */
  plaster: MeshStandardMaterial;
  ceiling: MeshStandardMaterial;
  concrete: MeshStandardMaterial;
  pine: MeshStandardMaterial;
  steel: MeshStandardMaterial;
  copper: MeshStandardMaterial;
  header: MeshStandardMaterial;
  burlap: MeshStandardMaterial;
  grain: MeshStandardMaterial;
  terracotta: MeshStandardMaterial;
  stone: MeshStandardMaterial;
  straw: MeshStandardMaterial;
  /** instanced: colour = instance colour (baked light × tint), cells via aCell */
  label: MeshStandardMaterial;
  grainCells: MeshStandardMaterial;
  acrylic: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  binTrim: MeshStandardMaterial;
  lid: MeshStandardMaterial;
}

export function kitMaterials(t: Record<TextureName, Texture>): KitMaterials {
  const baked = (o: ConstructorParameters<typeof MeshStandardMaterial>[0]) => new MeshStandardMaterial({ vertexColors: true, metalness: 0, ...o });
  return {
    plaster: baked({ map: t.plaster, normalMap: t.plaster_n, roughness: 0.96 }),
    ceiling: baked({ map: t.plaster, normalMap: t.plaster_n, color: new Color("#8A6C54"), roughness: 1 }),
    concrete: baked({ map: t.concrete, roughness: 0.34 }),
    pine: baked({ map: t.pine, roughness: 0.68 }),
    steel: baked({ color: new Color("#2B2926"), roughness: 0.48 }),
    copper: baked({ color: new Color("#C27A4A"), roughness: 0.32 }),
    // header boards are lit signs: the white lettering carries a little light of its own over the baked dark
    header: baked({ map: t.headers, emissiveMap: t.headers, emissive: new Color("#FFF4E6"), emissiveIntensity: 0.55, roughness: 0.8 }),
    burlap: baked({ map: t.burlap, normalMap: t.burlap_n, roughness: 1 }),
    grain: baked({ map: t.grains, normalMap: t.grains_n, roughness: 0.82 }),
    terracotta: baked({ map: t.terracotta, roughness: 0.9 }),
    stone: baked({ map: t.stone, roughness: 0.92 }),
    straw: baked({ color: new Color("#E2C27C"), roughness: 0.9 }),
    label: withCells(new MeshStandardMaterial({ map: t.labels, roughness: 0.62 })),
    grainCells: withCells(new MeshStandardMaterial({ map: t.grains, normalMap: t.grains_n, roughness: 0.82 })),
    acrylic: new MeshStandardMaterial({ color: new Color("#F4F6F2"), transparent: true, opacity: 0.16, roughness: 0.06, depthWrite: false, side: DoubleSide }),
    glass: new MeshStandardMaterial({ color: new Color("#F6F6F2"), transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false }),
    binTrim: new MeshStandardMaterial({ color: new Color("#2B2926"), roughness: 0.48 }),
    lid: new MeshStandardMaterial({ color: new Color("#8C6A48"), roughness: 0.6 }),
  };
}
