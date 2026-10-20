// What the close-ups cost, for the ?debug=perf overlay and the close-up gate. A tiny module of its own:
// the 3D map reads it without pulling the hero chunk in.

import type { Texture } from "three";

export const heroStats = {
  /** "hi" or "lo", once a zone has loaded */
  tier: null as null | "hi" | "lo",
  /** close-up textures on the GPU now, every mip level, as transcoded on this device: every zone's, the open
   * one's and any other still (or already) uploaded; the ledger below */
  gpuBytes: 0,
  textures: 0,
  /** the gloss's baked environment maps on the GPU (kit/env.ts) */
  envBytes: 0,
  /** the most gpuBytes + envBytes ever resident at once in this page: the gate's combined check */
  peakBytes: 0,
  /** ms to fetch and transcode them */
  loadMs: 0,
  /** the open zone's triangles (static + every instance) */
  triangles: 0,
  /** every zone mounted, by id: "prepared" (built, textures transcoded, programs compiled, off the GPU) or
   * "uploaded" (on the GPU); a zone still loading is absent */
  zones: {} as Record<string, "prepared" | "uploaded">,
};

/** A zone's state for the gate (null: unmounted, or not yet prepared). */
export function zoneState(id: string, state: "prepared" | "uploaded" | null) {
  if (state) heroStats.zones[id] = state;
  else delete heroStats.zones[id];
}

// The ledger: a texture counts from its upload (three calls `onUpdate` after each one) until its GPU copy is
// freed (`dispose`; the transcoded data stays in the object, and three uploads it again on its next use).
const resident = new Map<Texture, number>();
const tracked = new WeakSet<Texture>();

function total() {
  let sum = 0;
  for (const b of resident.values()) sum += b;
  heroStats.gpuBytes = sum;
  heroStats.textures = resident.size;
  heroStats.peakBytes = Math.max(heroStats.peakBytes, sum + heroStats.envBytes);
}

/** Count a close-up texture while it is on the GPU. */
export function trackTexture(t: Texture, bytes: number) {
  if (tracked.has(t)) return;
  tracked.add(t);
  t.onUpdate = () => {
    resident.set(t, bytes);
    total();
  };
  t.addEventListener("dispose", () => {
    resident.delete(t);
    total();
  });
}

/** An environment map's bytes: + at its bake, − at its dispose. */
export function envResident(delta: number) {
  heroStats.envBytes += delta;
  total();
}
