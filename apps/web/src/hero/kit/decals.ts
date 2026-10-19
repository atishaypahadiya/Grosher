// Shadow decals: soft dark patches multiplied onto whatever is under them: a pack's shadow on its plank, a
// sack's or a pot's on the floor, the dark at the foot of the shelving and the island. One instanced mesh,
// one draw call, for every contact shadow in a zone; the spots' hard shadows are the shader's (light.ts).

import { DataTexture, InstancedBufferAttribute, InstancedMesh, LinearFilter, Matrix4, PlaneGeometry, Quaternion, ShaderMaterial, Vector3, Euler, CustomBlending, ZeroFactor, SrcColorFactor, AddEquation } from "three";
import type { V3 } from "./geom.ts";

export interface Decal {
  /** centre of the patch */
  pos: V3;
  /** width (x) and depth (z) before the turn */
  size: [number, number];
  /** turn about y; a wall decal stands up (`wall`), facing +z before the turn */
  rotY?: number;
  wall?: boolean;
  /** 0–1: how dark at its middle */
  shade: number;
  /** a soft rectangle (packs, fixtures) or a soft disc (sacks, pots) */
  round?: boolean;
}

/** two channels: r a soft rectangle, g a soft disc */
function shapeTexture(n = 64): DataTexture {
  const data = new Uint8Array(n * n * 4);
  const s = (t: number) => {
    const k = Math.max(0, Math.min(1, t));
    return k * k * (3 - 2 * k);
  };
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n;
      const v = (y + 0.5) / n;
      const rect = s(Math.min(u, 1 - u) / 0.32) * s(Math.min(v, 1 - v) / 0.32);
      const disc = s((0.5 - Math.hypot(u - 0.5, v - 0.5)) / 0.3);
      const i = (y * n + x) * 4;
      data[i] = Math.round(rect * 255);
      data[i + 1] = Math.round(disc * 255);
      data[i + 3] = 255;
    }
  const t = new DataTexture(data, n, n);
  t.magFilter = t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function decalMesh(decals: Decal[]): InstancedMesh {
  const geo = new PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2); // lying on the floor, facing up
  const shade = new Float32Array(decals.length * 2);
  const mesh = new InstancedMesh(
    geo,
    new ShaderMaterial({
      uniforms: { uShape: { value: shapeTexture() } },
      vertexShader: /* glsl */ `
        attribute vec2 aShade;
        varying vec2 vUv;
        varying vec2 vShade;
        void main() {
          vUv = uv;
          vShade = aShade;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uShape;
        varying vec2 vUv;
        varying vec2 vShade;
        void main() {
          vec4 s = texture2D(uShape, vUv);
          float a = mix(s.r, s.g, vShade.y) * vShade.x;
          gl_FragColor = vec4(vec3(1.0 - a), 1.0);
        }`,
      // multiply: dst × src
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: ZeroFactor,
      blendDst: SrcColorFactor,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    decals.length,
  );
  const m = new Matrix4();
  const q = new Quaternion();
  decals.forEach((d, i) => {
    q.setFromEuler(new Euler(d.wall ? Math.PI / 2 : 0, d.rotY ?? 0, 0, "YXZ"));
    m.compose(new Vector3(...d.pos), q, new Vector3(d.size[0], 1, d.size[1]));
    mesh.setMatrixAt(i, m);
    shade[i * 2] = d.shade;
    shade[i * 2 + 1] = d.round ? 1 : 0;
  });
  geo.setAttribute("aShade", new InstancedBufferAttribute(shade, 2));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.renderOrder = 1;
  mesh.name = "hero-decals";
  return mesh;
}
