// Export / import of a store package: JSON files, texture images and the
// textures.json manifest. Writes into the package folder through the File
// System Access API where the browser has it; downloads otherwise.

import { parseStoreBundle, type TextureManifest } from "@grosher/stores";
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
  "textures/textures.json": Blob;
  images: { path: string; blob: Blob }[];
}

const json = (v: unknown) => new Blob([JSON.stringify(v, null, 2) + "\n"], { type: "application/json" });

export function buildExport(draft: Draft, manifest: TextureManifest, textures: TextureFile[]): ExportFiles {
  const merged: TextureManifest = { ...manifest };
  for (const t of textures) merged[t.deptId] = { file: t.file, w: t.w, h: t.h, shotAt: t.shotAt, repeatMeters: manifest[t.deptId]?.repeatMeters ?? 2 };
  return {
    "store.json": json({ ...draft.store, version: (draft.store.version ?? 0) + 1 }),
    "catalog.json": json(draft.catalog),
    "textures/textures.json": json(merged),
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
  download(files["textures/textures.json"], "textures.json");
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
    ["textures/textures.json", files["textures/textures.json"]],
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
export async function importFiles(files: File[], current: Draft): Promise<{ draft: Draft; notes: string[] }> {
  let draft = current;
  const notes: string[] = [];
  for (const f of files) {
    const text = await f.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      notes.push(`${f.name}: not JSON`);
      continue;
    }
    if (Array.isArray(data)) {
      const { catalog } = parseStoreBundle({ store: draft.store, catalog: data });
      draft = { ...draft, catalog };
      notes.push(`${f.name}: ${catalog.length} catalog items`);
    } else if (data && typeof data === "object" && "nodes" in (data as object)) {
      const { store } = parseStoreBundle({ store: data, catalog: draft.catalog });
      draft = { ...draft, store };
      notes.push(`${f.name}: store ${store.storeId} with ${store.nodes.length} nodes`);
    } else if (data && typeof data === "object" && "store" in (data as object)) {
      const b = parseStoreBundle(data as { store: unknown; catalog: unknown });
      draft = { store: b.store, catalog: b.catalog };
      notes.push(`${f.name}: bundle`);
    } else {
      notes.push(`${f.name}: not a store, catalog or bundle`);
    }
  }
  return { draft, notes };
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
