// The sign-reading queue. Capture never waits on it: a photo is stored and queued, and this reads queued
// photos one at a time whenever the phone is online, through the worker (or a direct Ollama) to the vision
// model, then matchSign() maps the words onto the store's categories. A failure waits and retries: 5 s,
// then doubling, at most 5 minutes apart; going back online retries at once.

import { matchSign, type Category } from "@grosher/core";
import type { SignReader } from "../lib/resolver.ts";
import type { SurveyPhoto } from "./model.ts";
import { loadPhoto, toBase64 } from "./photos.ts";

export const RETRY_BASE_MS = 5_000;
export const RETRY_MAX_MS = 5 * 60_000;

export const backoff = (attempts: number) => Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));

/** the next photo to read: queued first, in order taken; then failed ones whose wait is over */
export function nextToRead(photos: SurveyPhoto[], now: number): SurveyPhoto | null {
  return photos.find((p) => p.status === "queued") ?? photos.find((p) => p.status === "failed" && (p.retryAt ?? 0) <= now) ?? null;
}

/** Read one photo; the patch to apply to it. Never throws. */
export async function readPhoto(p: SurveyPhoto, reader: SignReader, categories: Category[], now = () => Date.now()): Promise<Partial<SurveyPhoto>> {
  try {
    const stored = await loadPhoto(p.id);
    if (!stored) return { status: "failed", attempts: p.attempts + 1, error: "The photo is missing on this device.", retryAt: Number.MAX_SAFE_INTEGER };
    const words = await reader.read(await toBase64(stored.blob));
    return { status: "done", words, reading: matchSign(words, categories), error: undefined, retryAt: undefined };
  } catch (e) {
    const attempts = p.attempts + 1;
    const why = e instanceof Error ? e.message : String(e);
    return { status: "failed", attempts, retryAt: now() + backoff(attempts), error: /abort/i.test(why) ? "The model took too long." : why.slice(0, 120) };
  }
}

/** a status line for a photo in the running list */
export function photoStatus(p: SurveyPhoto, online: boolean, now: number): string {
  if (p.status === "done") {
    const n = p.reading?.matches.length ?? 0;
    return n ? `read · ${n} ${n === 1 ? "category" : "categories"}` : `read · no category (${(p.words ?? []).slice(0, 3).join(", ") || "no words"})`;
  }
  if (p.status === "reading") return "reading…";
  if (!online) return "waiting for a connection";
  if (p.status === "queued") return "queued";
  if ((p.retryAt ?? 0) >= Number.MAX_SAFE_INTEGER) return p.error ?? "failed";
  return `retrying in ${Math.max(1, Math.round(((p.retryAt ?? now) - now) / 1000))} s · ${p.error ?? "failed"}`;
}
