// A cheap gloss for the zone's polished concrete, glass and acrylic: an environment map baked once from a
// sketch of the room (warm clay walls and ceiling, the rows of track spots and downlights, the lit shelf faces)
// through three's PMREM, at 64 px: blurred reflections, no planar reflection, no extra pass per frame.
// ~0.7 MB on the GPU (counted in heroStats), nothing to download. The sketch is the same for every zone, so one
// bake is shared by every zone mounted (the open one and the next one prepared) and freed with the last.

import { BackSide, BoxGeometry, Color, Mesh, MeshBasicMaterial, PMREMGenerator, Scene, Vector3, type Texture, type WebGLRenderer, type WebGLRenderTarget } from "three";
import { envResident } from "../stats.ts";

export const ENV_SIZE = 64;

/** the sketch: a long warm room, bright light rows overhead, the two shelf faces either side */
function room(): Scene {
  const s = new Scene();
  const add = (w: number, h: number, d: number, color: Color, pos: [number, number, number], back = false) => {
    const m = new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial({ color, side: back ? BackSide : undefined }));
    m.position.set(...pos);
    s.add(m);
  };
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

export function bakeEnv(gl: WebGLRenderer): Env {
  const pmrem = new PMREMGenerator(gl);
  const scene = room();
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

let shared: { gl: WebGLRenderer; env: Env; users: number } | null = null;
/** The shared environment map for a zone: baked by the first zone that asks, freed when the last lets go. */
export function acquireEnv(gl: WebGLRenderer): { texture: Texture; release: () => void } {
  if (!shared || shared.gl !== gl) {
    shared?.env.dispose();
    shared = { gl, env: bakeEnv(gl), users: 0 };
  }
  const s = shared;
  s.users++;
  let held = true;
  return {
    texture: s.env.texture,
    release: () => {
      if (!held) return;
      held = false;
      if (--s.users > 0) return;
      s.env.dispose();
      if (shared === s) shared = null;
    },
  };
}
