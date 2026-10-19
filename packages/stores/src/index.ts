// Store data for Grosher. Each store is a StoreGraph plus a catalog of
// resolved items, kept as plain JSON under data/<storeId>/ so the web app's
// edit mode can export straight into this package.

import type { Category, StoreGraph, Stop } from "@grosher/core";
import demoStore from "../demo/store.json" with { type: "json" };
import demoBaseCatalog from "../demo/catalog.base.json" with { type: "json" };
import demoCategories from "../demo/categories.json" with { type: "json" };
import demoTextures from "../demo/textures/textures.json" with { type: "json" };
import grosherStore from "../grosher/store.json" with { type: "json" };
import grosherBaseCatalog from "../grosher/catalog.base.json" with { type: "json" };
import grosherCategories from "../grosher/categories.json" with { type: "json" };
import grosherTextures from "../grosher/textures/textures.json" with { type: "json" };
import grosherLists from "../grosher/lists.json" with { type: "json" };
import { carryCatalog, type Rehome } from "./carry.ts";
import { handlingTags } from "./handling.ts";

export { DEPARTMENTS, departmentById } from "./departments.ts";
export * from "./geometry.ts";
export * from "./slots.ts";
export * from "./resolveContext.ts";
export { reconcile, catalogKey, isBaseRow, type CatalogRow } from "./reconcile.ts";
export { carryCatalog, type Rehome } from "./carry.ts";
export { handlingTags, HANDLING_TAGS, MULTIPACK, MULTIPACK_SHELVES } from "./handling.ts";

/** textures.json: one entry per department that has a photo (or placeholder). */
export type TextureManifest = Record<string, { file: string; w: number; h: number; shotAt: string | null; repeatMeters: number }>;

/** catalog.json: a bare array (surveyed by hand), the seed's file, or the merged file with its sources */
export interface CatalogFile {
  generatedAt?: string | null;
  model?: string | null;
  seeded?: string[];
  sources?: { origin: string; name: string; items: number; terms?: string; importedAt?: string; generatedAt?: string | null }[];
  mergedAt?: string;
  items: Stop[];
}

export interface StoreBundle {
  store: StoreGraph;
  /**
   * The rows available synchronously. For the demo this is the 30 hand-kept base rows; the full 47,000-item
   * catalog is a 7 MB file that loads on demand through `loadCatalog`, in its own chunk, so the app shell
   * stays small.
   */
  catalog: Stop[];
  /** the full catalog, fetched and cached on first call; resolves to `catalog` for a store with no larger file */
  loadCatalog: () => Promise<Stop[]>;
  /** the shelf categories (aisle signs → bay runs); empty for a store not yet surveyed at that level */
  categories: Category[];
  /** when the catalog was seeded by a model: date and model */
  catalogMeta?: { generatedAt: string | null; model: string | null };
  textures: TextureManifest;
  /** absolute URL of a texture file, resolved against this package (works in Vite and Node) */
  textureUrl: (file: string) => string;
  /** saved lists the store ships for demos (Grosher's hero lists), offered once per browser */
  lists?: { id: string; name: string; items: string[] }[];
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
  const rows = catalog as Stop[];
  return { store: store as StoreGraph, catalog: rows, loadCatalog: async () => rows, categories, catalogMeta, textures, textureUrl };
}

/** `bundle` with a lazily loaded full catalog (base rows first, then the file's rows that are not base rows) */
export function withLazyCatalog(bundle: StoreBundle, load: () => Promise<CatalogFile | Stop[]>): StoreBundle {
  let promise: Promise<Stop[]> | null = null;
  const meta: { current?: StoreBundle["catalogMeta"] } = {};
  const loadCatalog = () =>
    (promise ??= load().then((file) => {
      const items = Array.isArray(file) ? file : file.items;
      if (!Array.isArray(file)) meta.current = { generatedAt: file.generatedAt ?? file.mergedAt ?? null, model: file.model ?? null };
      const baseIds = new Set(bundle.catalog.map((s) => s.id));
      const locIds = new Set(bundle.store.locations.map((l) => l.id));
      return [...bundle.catalog, ...items.filter((s) => !baseIds.has(s.id) && s.locationIds.every((l) => locIds.has(l)))];
    }));
  return { ...bundle, loadCatalog };
}

export const demoSupercenter: StoreBundle = withLazyCatalog(
  parseStoreBundle({ store: demoStore, catalog: demoBaseCatalog, categories: demoCategories, textures: demoTextures }, (file) => new URL(`../demo/textures/${file}`, import.meta.url).href),
  // a dynamic import, so Vite emits the 7 MB catalog as its own precached chunk
  () => import("../demo/catalog.json", { with: { type: "json" } }).then((m) => m.default as unknown as CatalogFile),
);

/**
 * Grosher, our own designed market (design/store-grosher.md, scripts/gen-grosher.ts): the default store. Its
 * full catalog is the demo's 47,612 rows carried onto Grosher's shelves at load time (same categories, plus
 * grosher/rehome.json for the rows Walmart grocery had no shelf for), so the 7 MB file ships once. Finishes
 * (wood, stainless) are its own textures; department textures are the demo's placeholders.
 */
const GROSHER_FILES = new Set(Object.values(grosherTextures).map((t) => t.file));
export const grosher: StoreBundle = {
  ...withLazyCatalog(
    parseStoreBundle({ store: grosherStore, catalog: grosherBaseCatalog, categories: grosherCategories, textures: { ...demoTextures, ...grosherTextures } }, (file) =>
      GROSHER_FILES.has(file) ? new URL(`../grosher/textures/${file}`, import.meta.url).href : new URL(`../demo/textures/${file}`, import.meta.url).href,
    ),
    () =>
      Promise.all([
        import("../demo/catalog.json", { with: { type: "json" } }).then((m) => m.default as unknown as CatalogFile),
        import("../grosher/rehome.json", { with: { type: "json" } }).then((m) => (m.default as unknown as { items: Rehome }).items),
      ]).then(([file, rehome]) => ({ ...file, items: carryCatalog(file.items, demoCategories as Category[], grosherCategories as Category[], rehome, (s, cat) => handlingTags(s.tags, cat, s.name)) })),
  ),
  lists: grosherLists,
};

/** Every store the app can open. The first is the default; the demo Supercenter is kept for the tests and as
 * the Walmart reference taxonomy a Walmart survey (Story Rd) matches its signs against, never offered. */
export const STORES: StoreBundle[] = [grosher, demoSupercenter];
export const DEFAULT_STORE = grosher;

export function getStore(storeId: string): StoreBundle | undefined {
  return STORES.find((b) => b.store.storeId === storeId);
}
