// Store data for Grosher. Each store is a StoreGraph plus a catalog of
// resolved items, kept as plain JSON under data/<storeId>/ so the web app's
// edit mode can export straight into this package.

import type { StoreGraph, Stop } from "@grosher/core";
import demoStore from "../demo/store.json" with { type: "json" };
import demoCatalog from "../demo/catalog.json" with { type: "json" };
import demoTextures from "../demo/textures/textures.json" with { type: "json" };

export { DEPARTMENTS, departmentById } from "./departments.ts";
export * from "./geometry.ts";
export * from "./slots.ts";

/** textures.json: one entry per department that has a photo (or placeholder). */
export type TextureManifest = Record<string, { file: string; w: number; h: number; shotAt: string | null; repeatMeters: number }>;

export interface StoreBundle {
  store: StoreGraph;
  catalog: Stop[];
  textures: TextureManifest;
  /** absolute URL of a texture file, resolved against this package (works in Vite and Node) */
  textureUrl: (file: string) => string;
}

/** Minimal shape check for JSON coming from disk or an edit-mode import. Throws on bad input. */
export function parseStoreBundle(raw: { store?: unknown; catalog?: unknown; textures?: unknown }, textureUrl: (file: string) => string = (f) => f): StoreBundle {
  const store = raw.store as Partial<StoreGraph> | undefined;
  const catalog = raw.catalog as Partial<Stop>[] | undefined;
  if (!store || typeof store.storeId !== "string") throw new Error("store.storeId missing");
  for (const key of ["nodes", "edges", "locations", "checkoutIds"] as const) {
    if (!Array.isArray(store[key])) throw new Error(`store.${key} must be an array`);
  }
  for (const key of ["entranceId", "exitId"] as const) {
    if (typeof store[key] !== "string") throw new Error(`store.${key} missing`);
  }
  if (!Array.isArray(catalog)) throw new Error("catalog must be an array");
  for (const s of catalog) {
    if (typeof s.id !== "string" || typeof s.name !== "string" || !Array.isArray(s.locationIds)) {
      throw new Error(`catalog item ${JSON.stringify(s.id)}: needs id, name, locationIds`);
    }
  }
  const textures = (raw.textures ?? {}) as TextureManifest;
  return { store: store as StoreGraph, catalog: catalog as Stop[], textures, textureUrl };
}

export const demoSupercenter: StoreBundle = parseStoreBundle(
  { store: demoStore, catalog: demoCatalog, textures: demoTextures },
  (file) => new URL(`../demo/textures/${file}`, import.meta.url).href,
);

export const STORES: StoreBundle[] = [demoSupercenter];

export function getStore(storeId: string): StoreBundle | undefined {
  return STORES.find((b) => b.store.storeId === storeId);
}
