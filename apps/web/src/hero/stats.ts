// What the open hero zone costs, for the ?debug=perf overlay and the close-up gate. A tiny module of its own:
// the 3D map reads it without pulling the hero chunk in.

export const heroStats = {
  /** "hi" or "lo", once a zone has loaded */
  tier: null as null | "hi" | "lo",
  /** the hero textures on the GPU, every mip level, as transcoded on this device */
  gpuBytes: 0,
  textures: 0,
  /** the gloss's baked environment map on the GPU (kit/env.ts) */
  envBytes: 0,
  /** ms to fetch and transcode them */
  loadMs: 0,
  /** the zone's triangles (static + every instance) */
  triangles: 0,
};
