// Store data for Grosher. Each store is a StoreGraph plus a catalog of
// resolved items, kept as plain JSON under data/<storeId>/ so the web app's
// edit mode can export straight into this package.

import type { StoreGraph, Stop } from "@grosher/core";
import demoStore from "../data/demo-supercenter/store.json" with { type: "json" };
import demoCatalog from "../data/demo-supercenter/catalog.json" with { type: "json" };

export interface StoreBundle {
  store: StoreGraph;
  catalog: Stop[];
}

/** Minimal shape check for JSON coming from disk or an edit-mode import. Throws on bad input. */
export function parseStoreBundle(raw: { store?: unknown; catalog?: unknown }): StoreBundle {
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
  return { store: store as StoreGraph, catalog: catalog as Stop[] };
}

export const demoSupercenter: StoreBundle = parseStoreBundle({ store: demoStore, catalog: demoCatalog });

export const STORES: StoreBundle[] = [demoSupercenter];

export function getStore(storeId: string): StoreBundle | undefined {
  return STORES.find((b) => b.store.storeId === storeId);
}
