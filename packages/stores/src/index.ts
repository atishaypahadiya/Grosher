// Store data for Grosher. Each store is a StoreGraph plus a catalog of
// resolved items, kept as plain JSON under data/<storeId>/ so the web app's
// edit mode can export straight into this package.

import type { Category, StoreGraph, Stop } from "@grosher/core";
import demoStore from "../demo/store.json" with { type: "json" };
import demoCatalog from "../demo/catalog.json" with { type: "json" };
import demoCategories from "../demo/categories.json" with { type: "json" };
import demoTextures from "../demo/textures/textures.json" with { type: "json" };

export { DEPARTMENTS, departmentById } from "./departments.ts";
export * from "./geometry.ts";
export * from "./slots.ts";
export * from "./resolveContext.ts";

/** textures.json: one entry per department that has a photo (or placeholder). */
export type TextureManifest = Record<string, { file: string; w: number; h: number; shotAt: string | null; repeatMeters: number }>;

/** catalog.json: either a bare array (surveyed by hand) or the seeded file with its header */
export interface CatalogFile {
  generatedAt: string | null;
  model: string | null;
  seeded: string[];
  items: Stop[];
}

export interface StoreBundle {
  store: StoreGraph;
  catalog: Stop[];
  /** the shelf categories (aisle signs → bay runs); empty for a store not yet surveyed at that level */
  categories: Category[];
  /** when the catalog was seeded by a model: date and model */
  catalogMeta?: { generatedAt: string | null; model: string | null };
  textures: TextureManifest;
  /** absolute URL of a texture file, resolved against this package (works in Vite and Node) */
  textureUrl: (file: string) => string;
}

/** Minimal shape check for JSON coming from disk or an edit-mode import. Throws on bad input. */
export function parseStoreBundle(raw: { store?: unknown; catalog?: unknown; categories?: unknown; textures?: unknown }, textureUrl: (file: string) => string = (f) => f): StoreBundle {
  const store = raw.store as Partial<StoreGraph> | undefined;
  const file = raw.catalog as Partial<CatalogFile> | Partial<Stop>[] | undefined;
  const catalog = (Array.isArray(file) ? file : file?.items) as Partial<Stop>[] | undefined;
  const catalogMeta = Array.isArray(file) || !file ? undefined : { generatedAt: file.generatedAt ?? null, model: file.model ?? null };
  const categories = (Array.isArray(raw.categories) ? raw.categories : []) as Category[];
  const locIds = new Set((store?.locations ?? []).map((l) => l.id));
  for (const c of categories) {
    if (typeof c.id !== "string" || typeof c.locationId !== "string") throw new Error(`category ${JSON.stringify(c.id)}: needs id and locationId`);
    if (!locIds.has(c.locationId)) throw new Error(`category ${c.id}: unknown location ${c.locationId}`);
  }
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
  return { store: store as StoreGraph, catalog: catalog as Stop[], categories, catalogMeta, textures, textureUrl };
}

export const demoSupercenter: StoreBundle = parseStoreBundle(
  { store: demoStore, catalog: demoCatalog, categories: demoCategories, textures: demoTextures },
  (file) => new URL(`../demo/textures/${file}`, import.meta.url).href,
);

export const STORES: StoreBundle[] = [demoSupercenter];

export function getStore(storeId: string): StoreBundle | undefined {
  return STORES.find((b) => b.store.storeId === storeId);
}
