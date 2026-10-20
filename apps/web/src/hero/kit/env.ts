// A cheap gloss for the zone's polished concrete, glass and acrylic: an environment map baked once from a
// sketch of the room (warm clay walls and ceiling, the rows of track spots and downlights, the lit shelf faces)
// through three's PMREM, at 64 px: blurred reflections, no planar reflection, no extra pass per frame.
// ~0.7 MB on the GPU (counted in heroStats), nothing to download. The sketch is the same for every zone, so one
// bake is shared by every zone mounted (the open one and the next one prepared) and freed with the last.

import { BackSide, BoxGeometry, Color, Mesh, MeshBasicMaterial, PMREMGenerator, Scene, Vector3, type Texture, type WebGLRenderer, type WebGLRenderTarget } from "three";
import { envResident } from "../stats.ts";

export const ENV_SIZE = 64;

/** which room the gloss reflects: a lamplit aisle (warm clay, rows of spots), or Produce's daylit room */
export type EnvPalette = "warm" | "daylight";

/** the sketch: a long room, its light overhead (rows of spots, or a skylight), the two shelf faces either side */
function room(palette: EnvPalette = "warm"): Scene {
  const s = new Scene();
  const add = (w: number, h: number, d: number, color: Color, pos: [number, number, number], back = false) => {
    const m = new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial({ color, side: back ? BackSide : undefined }));
    m.position.set(...pos);
    s.add(m);
  };
  if (palette === "daylight") {
    // pale walls and ceiling, a wood floor, the skylight a broad bright panel overhead, produce either side
    add(40, 4.4, 8, new Color("#B8B2A8"), [0, 2.2, 0], true);
    add(40, 0.02, 8, new Color("#8A6040"), [0, 0.01, 0]);
    add(30, 0.02, 5, new Color("#FFFFFF").multiplyScalar(4.5), [0, 4.35, 0]);
    for (const z of [-2.5, 2.5]) add(40, 1.2, 0.05, new Color("#8A9A5A"), [0, 0.8, z]);
    return s;
  }
  add(40, 4.4, 4, new Color("#8C6C50"), [0, 2.2, 0], true);
  // the lit shelf faces, warm and busy, both sides of the aisle
  for (const z of [-1.3, 1.3]) add(40, 1.9, 0.05, new Color("#C49A6C"), [0, 1.15, z]);
  // the light rows: track spots and downlights, seen from below, much brighter than anything else
  const lamp = new Color("#FFE2B8").multiplyScalar(6);
  for (let x = -18; x <= 18; x += 1.8) for (const z of [-0.35, 0.35]) add(0.09, 0.02, 0.09, lamp, [x, 4.3, z]);
  for (let x = -18; x <= 18; x += 3.6) add(0.18, 0.01, 0.18, lamp, [x + 0.9, 4.39, 0]);
  return s;
}

export interface Env {
  texture: Texture;
  bytes: number;
  dispose: () => void;
}

export function bakeEnv(gl: WebGLRenderer, palette: EnvPalette = "warm"): Env {
  const pmrem = new PMREMGenerator(gl);
  const scene = room(palette);
  const rt: WebGLRenderTarget = pmrem.fromScene(scene, 0.03, 0.1, 50, { size: ENV_SIZE, position: new Vector3(0, 1.2, 0) });
  pmrem.dispose();
  scene.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
  });
  // the cube-UV texture: RGBA half floats
  const bytes = rt.width * rt.height * 8;
  envResident(bytes);
  let live = true;
  return {
    texture: rt.texture,
    bytes,
    dispose: () => {
      if (!live) return;
      live = false;
      envResident(-bytes);
      rt.dispose();
    },
  };
}

const shared = new Map<EnvPalette, { gl: WebGLRenderer; env: Env; users: number }>();
/**
 * The shared environment map for a zone: baked by the first zone that asks, freed when the last lets go. Every
 * palette is baked at the same size, so a material compiled with one draws with another (Produce compiles
 * with the warm one while it is only prepared, and takes its daylight one when it goes on the GPU).
 */
export function acquireEnv(gl: WebGLRenderer, palette: EnvPalette = "warm"): { texture: Texture; release: () => void } {
  let s = shared.get(palette);
  if (!s || s.gl !== gl) {
    s?.env.dispose();
    s = { gl, env: bakeEnv(gl, palette), users: 0 };
    shared.set(palette, s);
  }
  s.users++;
  let held = true;
  return {
    texture: s.env.texture,
    release: () => {
      if (!held) return;
      held = false;
      if (--s.users > 0) return;
      s.env.dispose();
      if (shared.get(palette) === s) shared.delete(palette);
    },
  };
}
