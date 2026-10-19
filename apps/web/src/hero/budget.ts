// The close-up budget: what an eye-level hero zone may cost, separate from the overview's (DESIGN.md §3:
// 70 draw calls, 12,000 product instances). Enforced in CI by scripts/hero-gate.mjs on the production build
// and in test/hero-zone.test.ts on the geometry.
//
//   draw calls      per frame, every pass (the bloom included), at eye level facing the shelf
//   triangles       per frame, the same
//   gpuTextureMB    the hero textures as transcoded on the device, every mip level (hi tier)
//   downloadKB      what opening a close-up fetches, compressed on the wire: the hero chunk, its textures
//                   (hi tier) and the Basis transcoder (served once, cached by the service worker)
//
// Why these: a recent iPhone holds 60 fps well under ~100 draw calls and ~500k triangles of simple lit
// materials; the store map spends ~45 calls, so a close-up gets 70 in all, the overview's own ceiling. The
// first zone (Bulk & pulses, 18 Oct 2026) measured 51–53 calls, 157k triangles, 4.8 MB of textures on a
// desktop GPU (BC; an iPhone transcodes to ASTC 4×4, up to twice that) and a 1.6 MB download: each budget
// leaves the next zone room without letting it double.

export const CLOSE_UP_BUDGET = {
  drawCalls: 70,
  triangles: 250_000,
  gpuTextureMB: 16,
  downloadKB: 2_500,
};
