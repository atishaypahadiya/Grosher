// Sign photos: downscaled in the browser to ~1024 px on the long edge (a JPEG a vision model reads well and
// the gate takes: ~150–400 KB), kept in IndexedDB under survey-photo:<id>, never in the survey itself.

import { dbGet, dbSet } from "../lib/db.ts";

export const PHOTO_EDGE = 1024;
export const PHOTO_QUALITY = 0.82;

export interface StoredPhoto {
  blob: Blob;
  w: number;
  h: number;
}

const key = (id: string) => `survey-photo:${id}`;

/** A camera file → a ≤ 1024 px JPEG. */
export async function downscale(file: Blob): Promise<StoredPhoto> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, PHOTO_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas to downscale the photo.");
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", PHOTO_QUALITY));
  if (!blob) throw new Error("The photo could not be encoded.");
  return { blob, w, h };
}

export const savePhoto = (id: string, p: StoredPhoto) => dbSet(key(id), p);
export const loadPhoto = (id: string) => dbGet<StoredPhoto | null>(key(id), null);

/** base64 without the data: prefix (what /api/chat's images[] and the worker's /sign take) */
export async function toBase64(blob: Blob): Promise<string> {
  const url = await toDataUrl(blob);
  return url.slice(url.indexOf(",") + 1);
}

export function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("could not read the photo"));
    r.readAsDataURL(blob);
  });
}

/** a photo in an imported survey file: a base64 JPEG / PNG / WebP data: URL, nothing else (never fetched) */
const PHOTO_DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
/** ~4 MB of base64: a 1024 px JPEG is a tenth of that */
export const MAX_PHOTO_DATA_URL = 4_000_000;

export function fromDataUrl(url: string): Blob {
  const m = url.length <= MAX_PHOTO_DATA_URL ? PHOTO_DATA_URL.exec(url) : null;
  if (!m) throw new Error("A photo in the survey file is not an image.");
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}
