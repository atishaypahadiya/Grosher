// A close-up's programs and buffers, made ready before the camera moves: its materials compiled for a render
// target (the scene is drawn into the post-processing composer's target: no tone mapping, linear output in the
// program, or the first real frame compiles them again, synchronously), then one draw into a 1 × 1 target from
// the door with every object in it, so each buffer and texture goes up to the GPU now and not in the first
// frame of the descent (that frame took 150 ms on an M4). On a GPU without parallel shader compiling (software
// rendering, some phones) a program finishes compiling on its first use, and that use must be here.

import { PerspectiveCamera, WebGLRenderTarget, type Camera, type Object3D, type Scene, type Texture, type WebGLRenderer } from "three";
import type { V3 } from "./geom.ts";

export function warmUp(gl: WebGLRenderer, scene: Scene, camera: Camera, group: Object3D, view: { from: V3; at: V3 }, textures: Texture[], done: () => void): () => void {
  let live = true;
  const finish = () => {
    if (!live) return;
    const wrapper = group.parent;
    if (wrapper) {
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
      gl.setRenderTarget(rt);
      gl.render(scene, eye);
      gl.setRenderTarget(prev);
      rt.dispose();
      for (const o of culled) o.frustumCulled = true;
      if (warmFixtures) warmFixtures.visible = false;
      wrapper.visible = was;
    }
    done();
  };
  const compileTarget = new WebGLRenderTarget(1, 1);
  const before = gl.getRenderTarget();
  gl.setRenderTarget(compileTarget);
  const compiling = gl.compileAsync(group, camera, scene);
  gl.setRenderTarget(before);
  compileTarget.dispose();
  compiling.then(finish, finish);
  return () => {
    live = false;
  };
}
