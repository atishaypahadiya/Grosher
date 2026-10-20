// A close-up's programs and buffers, made ready before the camera moves, in two steps.
//
// `compileZone`, while the zone is only prepared (the next stop's, during this one): its materials compiled for
// a render target (the scene is drawn into the post-processing composer's target: no tone mapping, linear
// output in the program, or the first real frame compiles them again, synchronously). Nothing goes to the GPU
// but programs: compiling uploads no texture and no buffer.
//
// `uploadZone`, once the zone may be resident (it is open, or next to open and the zone before it has been
// freed): its textures uploaded, then one draw into a 1 × 1 target from the door with every object in it, so
// each buffer and texture goes up to the GPU now and not in the first frame of the descent (that frame took
// 150 ms on an M4). On a GPU without parallel shader compiling (software rendering, some phones) a program
// finishes compiling on its first use, and that use must be here.
//
// So at most one zone is on the GPU beside the next one's programs: the budget (budget.ts) holds for the
// trip, not only for each zone alone.

import { PerspectiveCamera, WebGLRenderTarget, type Camera, type Object3D, type Scene, type Texture, type WebGLRenderer } from "three";
import type { V3 } from "./geom.ts";

/** Compile a prepared zone's programs; resolves when they are ready (or failed: the draw will tell). */
export function compileZone(gl: WebGLRenderer, scene: Scene, camera: Camera, group: Object3D): Promise<void> {
  const compileTarget = new WebGLRenderTarget(1, 1);
  const before = gl.getRenderTarget();
  gl.setRenderTarget(compileTarget);
  const compiling = gl.compileAsync(group, camera, scene);
  gl.setRenderTarget(before);
  compileTarget.dispose();
  return compiling.then(
    () => undefined,
    () => undefined,
  );
}

/** Put a compiled zone on the GPU: its textures, then every buffer and program in one 1 × 1 draw. */
export function uploadZone(gl: WebGLRenderer, scene: Scene, group: Object3D, view: { from: V3; at: V3 }, textures: Texture[]) {
  const wrapper = group.parent;
  if (!wrapper) return;
  for (const t of textures) gl.initTexture(t);
  const was = wrapper.visible;
  wrapper.visible = true;
  // the overview's fixtures as they will be once the close-up shows (Fixtures keeps them hidden till then)
  const warmFixtures = scene.getObjectByName("fixtures-warm");
  if (warmFixtures) warmFixtures.visible = true;
  const eye = new PerspectiveCamera(80, 1, 0.05, 120);
  eye.position.set(...view.from);
  eye.lookAt(...view.at);
  const culled: Object3D[] = [];
  for (const root of [group, warmFixtures])
    root?.traverse((o) => {
      if (o.frustumCulled) {
        o.frustumCulled = false;
        culled.push(o);
      }
    });
  const rt = new WebGLRenderTarget(1, 1);
  const prev = gl.getRenderTarget();
  // a one-off upload, rasterised to one pixel: not part of any frame the shopper sees, so it stays out of the
  // frame's counts (the perf readout and the close-up gate read gl.info across every pass of a frame; on a
  // slow runner this draw landed in an arrival's first sample: 283k triangles, the zone twice over)
  const counted = { calls: gl.info.render.calls, triangles: gl.info.render.triangles, points: gl.info.render.points, lines: gl.info.render.lines };
  gl.setRenderTarget(rt);
  gl.render(scene, eye);
  gl.setRenderTarget(prev);
  if (!gl.info.autoReset) Object.assign(gl.info.render, counted);
  rt.dispose();
  for (const o of culled) o.frustumCulled = true;
  if (warmFixtures) warmFixtures.visible = false;
  wrapper.visible = was;
}

/**
 * Take a zone back off the GPU without unmounting it (it may no longer be resident: another close-up opened
 * first): every buffer in it and the given textures. The objects keep their data; three uploads them again on
 * their next use, which is `uploadZone`.
 */
export function unloadZone(group: Object3D, textures: Texture[]) {
  group.traverse((o) => (o as Object3D & { geometry?: { dispose: () => void } }).geometry?.dispose());
  for (const t of textures) t.dispose();
}
