// Geometry parts for fixture generators. Everything is built in a local
// frame where x runs along the fixture (bay 1 at +x when the front is the
// max end), y is up and z runs across; `place` turns that into map space.

import { BoxGeometry, BufferGeometry, PlaneGeometry } from "three";
import type { FixtureParams } from "@grosher/stores";

export interface Parts {
  opaque: BufferGeometry[];
  /** uprights, end panels and rails: black steel under a wood finish, otherwise drawn with the body */
  trim: BufferGeometry[];
  glass: BufferGeometry[];
  frame: BufferGeometry[];
  glow: BufferGeometry[];
}

export const emptyParts = (): Parts => ({ opaque: [], trim: [], glass: [], frame: [], glow: [] });

/** A box with UVs scaled so a texture repeats every `repeat` metres on every face. */
export function box(w: number, h: number, d: number, cx: number, cy: number, cz: number, repeat = 2): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [du, dv] = dims[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * du) / repeat, (uv.getY(i) * dv) / repeat);
    }
  }
  g.translate(cx, cy, cz);
  return g;
}

/** A vertical plane facing +z (or −z when flipped), w × h, centred at (cx, cy, cz). */
export function panel(w: number, h: number, cx: number, cy: number, cz: number, flip = false): BufferGeometry {
  const g = new PlaneGeometry(w, h);
  if (flip) g.rotateY(Math.PI);
  g.translate(cx, cy, cz);
  return g;
}

/** A horizontal plane facing up, w (along x) × d (along z), centred at (cx, cy, cz). */
export function flat(w: number, d: number, cx: number, cy: number, cz: number): BufferGeometry {
  const g = new PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(cx, cy, cz);
  return g;
}

/** Local frame → map space. Local x along the run, local z across. */
export function place(geos: BufferGeometry[], p: FixtureParams): BufferGeometry[] {
  for (const g of geos) {
    if (p.vertical) g.rotateY(-Math.PI / 2); // local x → map z
    g.translate(p.cx, 0, p.cz);
  }
  return geos;
}
