// Export / import of a store package: JSON files, texture images and the
// textures.json manifest. Writes into the package folder through the File
// System Access API where the browser has it; downloads otherwise.

import { parseStoreBundle, type TextureManifest } from "@grosher/stores";
import type { ItemMemory } from "@grosher/core";
import type { List } from "../lib/lists.ts";
import type { TripRecord } from "../lib/history.ts";
import type { Draft } from "./model.ts";

export interface TextureFile {
  deptId: string;
  file: string;
  blob: Blob;
  w: number;
  h: number;
  shotAt: string | null;
  url: string; // object URL for previews / the Textures layer
}

export interface ExportFiles {
  "store.json": Blob;
  "catalog.json": Blob;
  "categories.json": Blob;
  "textures/textures.json": Blob;
  "memory.json": Blob;
  "lists.json": Blob;
  images: { path: string; blob: Blob }[];
}

/** What the shopper opts to export with the package: all of it is personal. */
export interface Personal {
  memory: ItemMemory[];
  lists: List[];
  history: TripRecord[];
}
export const EMPTY_PERSONAL: Personal = { memory: [], lists: [], history: [] };

const json = (v: unknown) => new Blob([JSON.stringify(v, null, 2) + "\n"], { type: "application/json" });

/** `personal` is the shopper's own data; the editor passes it only when they opted in. Empty sets still write empty files. */
export function buildExport(draft: Draft, manifest: TextureManifest, textures: TextureFile[], personal: Personal = EMPTY_PERSONAL): ExportFiles {
  const merged: TextureManifest = { ...manifest };
  for (const t of textures) merged[t.deptId] = { file: t.file, w: t.w, h: t.h, shotAt: t.shotAt, repeatMeters: manifest[t.deptId]?.repeatMeters ?? 2 };
  return {
    "store.json": json({ ...draft.store, version: (draft.store.version ?? 0) + 1 }),
    "catalog.json": json(draft.catalog),
    "categories.json": json(draft.categories ?? []),
    "textures/textures.json": json(merged),
    "memory.json": json(personal.memory),
    "lists.json": json({ lists: personal.lists, history: personal.history }),
    images: textures.map((t) => ({ path: `textures/${t.file}`, blob: t.blob })),
  };
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export function downloadAll(files: ExportFiles) {
  download(files["store.json"], "store.json");
  download(files["catalog.json"], "catalog.json");
  download(files["categories.json"], "categories.json");
  download(files["textures/textures.json"], "textures.json");
  download(files["memory.json"], "memory.json");
  download(files["lists.json"], "lists.json");
  for (const img of files.images) download(img.blob, img.path.split("/").pop()!);
}

// File System Access API (Chrome / Edge desktop). Typed loosely: not in lib.dom everywhere.
interface DirHandle {
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
  name: string;
}

export const canWritePackage = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

export async function pickPackageDir(): Promise<DirHandle | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (o?: { mode?: string }) => Promise<DirHandle> }).showDirectoryPicker;
  if (!picker) return null;
  try {
    return await picker({ mode: "readwrite" });
  } catch {
    return null; // cancelled
  }
}

async function writeFile(dir: DirHandle, path: string, blob: Blob) {
  const parts = path.split("/");
  let d = dir;
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
  const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

/** Writes store.json, catalog.json, textures/textures.json and any new texture images into the chosen folder. */
export async function writePackage(dir: DirHandle, files: ExportFiles): Promise<string[]> {
  const written: string[] = [];
  for (const [path, blob] of [
    ["store.json", files["store.json"]],
    ["catalog.json", files["catalog.json"]],
    ["categories.json", files["categories.json"]],
    ["textures/textures.json", files["textures/textures.json"]],
    ["memory.json", files["memory.json"]],
    ["lists.json", files["lists.json"]],
  ] as const) {
    await writeFile(dir, path, blob);
    written.push(path);
  }
  for (const img of files.images) {
    await writeFile(dir, img.path, img.blob);
    written.push(img.path);
  }
  return written;
}

/** Reads one or more JSON files (store.json, catalog.json, a {store, catalog} bundle) into a draft patch. */
export interface ImportResult {
  draft: Draft;
  notes: string[];
  /** personal data found in the files (lists.json / memory.json), for the app to merge */
  lists?: unknown;
  history?: unknown;
  memory?: unknown;
}

export async function importFiles(files: File[], current: Draft): Promise<ImportResult> {
  let draft = current;
  const notes: string[] = [];
  const personal: Pick<ImportResult, "lists" | "history" | "memory"> = {};
  for (const f of files) {
    const text = await f.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      notes.push(`${f.name}: not JSON`);
      continue;
    }
    if (data && typeof data === "object" && !Array.isArray(data) && ("lists" in (data as object) || "history" in (data as object))) {
      const d = data as { lists?: unknown; history?: unknown };
      personal.lists = d.lists;
      personal.history = d.history;
      notes.push(`${f.name}: ${Array.isArray(d.lists) ? d.lists.length : 0} lists, ${Array.isArray(d.history) ? d.history.length : 0} trips`);
    } else if (Array.isArray(data) && data.every((x) => x && typeof x === "object" && "locationId" in (x as object) && "confirms" in (x as object))) {
      personal.memory = data;
      notes.push(`${f.name}: ${data.length} remembered items`);
    } else if (Array.isArray(data) && data.length && data.every((x) => x && typeof x === "object" && "locationId" in (x as object) && "group" in (x as object))) {
      const { categories } = parseStoreBundle({ store: draft.store, catalog: draft.catalog, categories: data });
      draft = { ...draft, categories };
      notes.push(`${f.name}: ${categories.length} categories`);
    } else if (Array.isArray(data)) {
      const { catalog } = parseStoreBundle({ store: draft.store, catalog: data });
      draft = { ...draft, catalog };
      notes.push(`${f.name}: ${catalog.length} catalog items`);
    } else if (data && typeof data === "object" && "nodes" in (data as object)) {
      const { store } = parseStoreBundle({ store: data, catalog: draft.catalog });
      draft = { ...draft, store };
      notes.push(`${f.name}: store ${store.storeId} with ${store.nodes.length} nodes`);
    } else if (data && typeof data === "object" && "store" in (data as object)) {
      const b = parseStoreBundle(data as { store: unknown; catalog: unknown; categories?: unknown });
      draft = { store: b.store, catalog: b.catalog, categories: b.categories.length ? b.categories : draft.categories };
      notes.push(`${f.name}: bundle`);
    } else {
      notes.push(`${f.name}: not a store, catalog or bundle`);
    }
  }
  return { draft, notes, ...personal };
}

/** Resize any image file to a 512×512 JPEG (q .8), the texture format of the package. */
export async function toTextureJpeg(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const bitmap = await createImageBitmap(file);
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  // cover-crop to square
  const s = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - s) / 2, (bitmap.height - s) / 2, s, s, 0, 0, size, size);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.8));
  return { blob, w: size, h: size };
}
