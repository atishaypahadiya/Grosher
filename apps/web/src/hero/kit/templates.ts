// Instanced templates of the shelf kit: the bulk bins (gravity bin, scoop bin). Each is one geometry per
// material, built once at the origin (base centre, front facing +z); a zone places every copy through an
// InstancedMesh (they are the targets: the stop's bin is lifted and lit), with a per-instance tag cell and a
// per-instance grain (shape and size). Packaged products are static (products.ts).

import { BoxGeometry, type BufferGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clean, place } from "./geom.ts";
import { grainMound } from "./pieces.ts";

export const BIN = { w: 0.34, h: 0.6, d: 0.34 };

/**
 * A gravity bin: a clear acrylic box with a black lid and a dispensing chute at the front foot, the grain
 * inside to a level (scaled per instance; the grain's texture comes from the world, so it never stretches),
 * and a tag on its face.
 */
export function gravityBin(): { acrylic: BufferGeometry; fill: BufferGeometry; trim: BufferGeometry; tag: BufferGeometry } {
  const { w, h, d } = BIN;
  const acrylic = clean(new BoxGeometry(w, h, d));
  place(acrylic, { pos: [0, h / 2 + 0.06, 0] });
  const body = clean(new BoxGeometry(w - 0.02, 1, d - 0.02));
  place(body, { pos: [0, 0.5, 0] });
  const top = grainMound({ w: w - 0.02, d: d - 0.02, peak: 0.03, seg: 6 });
  place(top, { pos: [0, 1, 0] });
  // from its own base: the instance sits it on the foot and scales it to the bin's level
  const fill = mergeGeometries([body, top])!;
  const lid = clean(new BoxGeometry(w + 0.012, 0.025, d + 0.012));
  place(lid, { pos: [0, h + 0.072, 0] });
  const chute = clean(new BoxGeometry(0.07, 0.07, 0.09));
  place(chute, { pos: [0, 0.03, d / 2 + 0.03], rot: [0.5, 0, 0] });
  const handle = clean(new BoxGeometry(0.1, 0.018, 0.03));
  place(handle, { pos: [0, 0.075, d / 2 + 0.05] });
  const foot = clean(new BoxGeometry(w, 0.06, d));
  place(foot, { pos: [0, 0.03, 0] });
  const trim = mergeGeometries([lid, chute, handle, foot])!;
  const tag = clean(new BoxGeometry(w * 0.8, w * 0.2, 0.002));
  place(tag, { pos: [0, 0.16, d / 2 + 0.004] });
  return { acrylic, fill, trim, tag };
}
/** the gravity bin's fill front: where its real grains go (local; y from the base) */
export const BIN_FILL = { base: 0.065, front: BIN.d / 2 - 0.01, w: BIN.w - 0.02 };

export const SCOOP = { w: 0.42, h: 0.3, d: 0.5, peak: 0.06, level: 0.72 };

/** A scoop bin: an open acrylic tub with a hinged lid tipped back, the grain mounded inside, a tag on its lip. */
export function scoopBin(): { acrylic: BufferGeometry; fill: BufferGeometry; trim: BufferGeometry; tag: BufferGeometry } {
  const { w, h, d } = SCOOP;
  const tub = clean(new BoxGeometry(w, h, d));
  place(tub, { pos: [0, h / 2, 0] });
  const lid = clean(new BoxGeometry(w, 0.008, d * 0.9));
  // hinged at the back edge, propped open 30° (it clears the shelf above the counter)
  const LID = 0.55;
  place(lid, { pos: [0, h + Math.sin(LID) * d * 0.45, -d / 2 + Math.cos(LID) * d * 0.45], rot: [LID, 0, 0] });
  const acrylic = mergeGeometries([tub, lid])!;
  // the grain: a body to the level (its sides show through the acrylic, in layers) and the mound on top
  const top = grainMound({ w: w - 0.02, d: d - 0.02, peak: SCOOP.peak, seg: 8 });
  place(top, { pos: [0, h * SCOOP.level, 0] });
  const body = clean(new BoxGeometry(w - 0.02, h * SCOOP.level - 0.01, d - 0.02));
  place(body, { pos: [0, (h * SCOOP.level + 0.01) / 2, 0] });
  const fill = mergeGeometries([body, top])!;
  const rim = clean(new BoxGeometry(w + 0.01, 0.02, 0.02));
  place(rim, { pos: [0, h, d / 2] });
  const hinge = clean(new BoxGeometry(w, 0.02, 0.02));
  place(hinge, { pos: [0, h, -d / 2] });
  const trim = mergeGeometries([rim, hinge])!;
  const tag = clean(new BoxGeometry(w * 0.72, w * 0.18, 0.002));
  place(tag, { pos: [0, h - 0.06, d / 2 + 0.003] });
  return { acrylic, fill, trim, tag };
}
