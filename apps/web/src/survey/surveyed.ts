// A surveyed store in the editor: #/edit?store=<storeId> opens the draft its survey built, as a bundle
// shaped like a package (the reference departments, textures and catalog loader come from the demo; the
// catalog stays empty until the catalog is carried over, see CLAUDE.md "How to map a new store").

import type { StoreBundle } from "@grosher/stores";
import { loadBuiltDraft } from "./store.ts";

export function storeParam(hash: string): string | null {
  const i = hash.indexOf("?");
  if (!hash.startsWith("#/edit") || i < 0) return null;
  return new URLSearchParams(hash.slice(i + 1)).get("store");
}

export function surveyedBundle(reference: StoreBundle, storeId: string): StoreBundle | null {
  const draft = loadBuiltDraft(storeId);
  if (!draft) return null;
  return { ...reference, store: draft.store, catalog: draft.catalog, categories: draft.categories ?? [], loadCatalog: async () => draft.catalog };
}
