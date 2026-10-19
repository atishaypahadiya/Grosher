// Instanced templates of the shelf kit: packaged products (stand-up pouch, kraft bag, jar, tin) and bulk
// bins (gravity bin, scoop bin). Each template is one geometry per material, built once at the origin (base
// centre, front facing +z); a zone places thousands of copies through InstancedMesh, with a per-instance
// atlas cell (aCell: the label, the bin tag or the grain) and a per-instance colour (the baked light, times a
// grain's tint). Label UVs: a cell's front region (u 12/128 → 1) on the front, its 12 px side strip (the
// pack's plain colour, kraft or band) everywhere else.

import { BoxGeometry, type BufferGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clean, cylinder, lathe, place } from "./geom.ts";
import { grainMound } from "./pieces.ts";

const FRONT_U0 = 13 / 128;
const STRIP_U = [2 / 128, 10 / 128];

/** Map a geometry's faces: +z-facing triangles take the front region (their 0–1 UVs), the rest the strip. */
function labelUVs(g: BufferGeometry, frontTest = (nz: number) => nz > 0.7): BufferGeometry {
  const nor = g.getAttribute("normal");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    if (frontTest(nor.getZ(i))) uv.setX(i, FRONT_U0 + uv.getX(i) * (1 - FRONT_U0));
    else uv.setXY(i, STRIP_U[0] + uv.getX(i) * (STRIP_U[1] - STRIP_U[0]), uv.getY(i));
  }
  return g;
}

/** A stand-up pouch: a gusseted base, the top pinched flat and sealed. */
export function pouch(w = 0.13, h = 0.21, d = 0.065): BufferGeometry {
  const g = clean(new BoxGeometry(w, h, d, 2, 6, 1));
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + h / 2) / h; // 0 bottom → 1 top
    const squeeze = t > 0.62 ? 1 - ((t - 0.62) / 0.38) * 0.82 : 1 + Math.sin(t * Math.PI) * 0.08;
    pos.setZ(i, pos.getZ(i) * squeeze);
    pos.setY(i, pos.getY(i) + h / 2);
  }
  g.computeVertexNormals();
  return labelUVs(g);
}

/** A kraft paper bag with its top rolled down twice. */
export function kraftBag(w = 0.16, h = 0.26, d = 0.11): BufferGeometry {
  const body = clean(new BoxGeometry(w, h, d, 1, 1, 1));
  place(body, { pos: [0, h / 2, 0] });
  labelUVs(body);
  const roll = clean(new BoxGeometry(w * 1.01, 0.035, d * 0.55));
  place(roll, { pos: [0, h + 0.0175, 0] });
  labelUVs(roll, () => false);
  return mergeGeometries([body, roll])!;
}

/** A glass jar: the glass, the contents inside, a label band round the middle, the lid. */
export function jar(r = 0.052, h = 0.15): { glass: BufferGeometry; fill: BufferGeometry; label: BufferGeometry; lid: BufferGeometry } {
  const glass = lathe(
    [
      [0, 0],
      [r * 0.92, 0],
      [r, 0.012],
      [r, h * 0.86],
      [r * 0.82, h * 0.93],
      [r * 0.82, h],
    ],
    18,
  );
  const fill = cylinder(r * 0.93, r * 0.93, h * 0.78, 16);
  place(fill, { pos: [0, h * 0.4, 0] });
  // UVs of the contents: around and up, within its grain cell
  const label = cylinder(r * 1.012, r * 1.012, h * 0.42, 22, true);
  place(label, { pos: [0, h * 0.44, 0] });
  // the label's front half faces +z: rotate the seam to the back
  label.rotateY(Math.PI / 2);
  // a cylinder's u runs clockwise seen from outside: mirror it so the lettering reads
  const lu = label.getAttribute("uv");
  for (let i = 0; i < lu.count; i++) lu.setX(i, FRONT_U0 + (1 - lu.getX(i)) * (1 - FRONT_U0));
  const lid = cylinder(r * 0.86, r * 0.86, 0.026, 18);
  place(lid, { pos: [0, h + 0.013, 0] });
  return { glass, fill, label, lid };
}

/** A tin with its label wrapped round. */
export function tin(r = 0.058, h = 0.13): BufferGeometry {
  const g = cylinder(r, r, h, 20);
  place(g, { pos: [0, h / 2, 0] });
  g.rotateY(Math.PI / 2);
  const nor = g.getAttribute("normal");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    if (Math.abs(nor.getY(i)) > 0.5) uv.setXY(i, STRIP_U[0] + 0.5 * (STRIP_U[1] - STRIP_U[0]), 0.5);
    else uv.setX(i, FRONT_U0 + (1 - uv.getX(i)) * (1 - FRONT_U0));
  }
  return g;
}

export const BIN = { w: 0.34, h: 0.6, d: 0.34 };

/**
 * A gravity bin: a clear acrylic box with a black lid and a dispensing chute at the front foot, the grain
 * inside to a level (scaled per instance), and a tag on its face.
 */
export function gravityBin(): { acrylic: BufferGeometry; fill: BufferGeometry; trim: BufferGeometry; tag: BufferGeometry } {
  const { w, h, d } = BIN;
  const acrylic = clean(new BoxGeometry(w, h, d));
  place(acrylic, { pos: [0, h / 2 + 0.06, 0] });
  // the grain: a box to the fill line (scale y per instance) with a mounded top; UVs span the cell
  const body = clean(new BoxGeometry(w - 0.02, 1, d - 0.02));
  place(body, { pos: [0, 0.5, 0] });
  const top = grainMound({ w: w - 0.02, d: d - 0.02, peak: 0.03, rect: [0, 0, 1, 1], seg: 6 });
  place(top, { pos: [0, 1, 0] });
  const fill = mergeGeometries([body, top])!;
  place(fill, { pos: [0, 0.07, 0] });
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

export const SCOOP = { w: 0.42, h: 0.3, d: 0.5 };

/** A scoop bin: an open acrylic tub with a hinged lid tipped back, the grain mounded inside, a tag on its lip. */
export function scoopBin(): { acrylic: BufferGeometry; fill: BufferGeometry; trim: BufferGeometry; tag: BufferGeometry } {
  const { w, h, d } = SCOOP;
  const tub = clean(new BoxGeometry(w, h, d));
  place(tub, { pos: [0, h / 2, 0] });
  const lid = clean(new BoxGeometry(w, 0.008, d * 0.9));
  // hinged at the back edge, tipped up 70°
  place(lid, { pos: [0, h + Math.sin(1.22) * d * 0.45, -d / 2 + Math.cos(1.22) * d * 0.45], rot: [1.22, 0, 0] });
  const acrylic = mergeGeometries([tub, lid])!;
  const fill = grainMound({ w: w - 0.02, d: d - 0.02, peak: 0.06, rect: [0, 0, 1, 1], seg: 8 });
  place(fill, { pos: [0, h * 0.72, 0] });
  const rim = clean(new BoxGeometry(w + 0.01, 0.02, 0.02));
  place(rim, { pos: [0, h, d / 2] });
  const hinge = clean(new BoxGeometry(w, 0.02, 0.02));
  place(hinge, { pos: [0, h, -d / 2] });
  const trim = mergeGeometries([rim, hinge])!;
  const tag = clean(new BoxGeometry(w * 0.72, w * 0.18, 0.002));
  place(tag, { pos: [0, h - 0.06, d / 2 + 0.003] });
  return { acrylic, fill, trim, tag };
}
