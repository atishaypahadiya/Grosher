// The Bulk & pulses zone at full detail (its own lazy chunk): the shelf kit's meshes for zone.ts, the hero
// textures, the shadow decals, the stop's bin lifted a little and lit lime with its real grains, and the
// zone's one realtime light (a hemisphere: every spot and downlight is per pixel in the materials, light.ts).
// Mounted by the 3D map only while a close-up is open in this zone.

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { BoxGeometry, Color, EdgesGeometry, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, WebGLRenderTarget, type Texture } from "three";
import type { StoreGraph } from "@grosher/core";
import { buildBulkZone, bulkRig, grainSurface, pickTarget, shapeOf, type Target } from "./zone.ts";
import { decalMesh } from "../kit/decals.ts";
import { grainLayer } from "../kit/grains.ts";
import { hex } from "../kit/bake.ts";
import { GRAINS } from "./recipe.ts";
import { kitMaterials, loadHeroTextures, pickTier, pinnedTier, TIER_KEY, type KitMaterials, type TextureName, type Tier } from "../kit/materials.ts";
import { save } from "../../lib/storage.ts";
import type { HeroTargetInfo } from "../index.ts";
import { heroStats } from "../stats.ts";

const LIME = new Color("#D4FF4A");
const LIFT = 0.03;
const PULL = 0.06;

export interface HeroZoneProps {
  store: StoreGraph;
  category: string;
  itemName: string;
  /** where the camera should stand: the target bin and the pan bounds */
  onTarget: (t: HeroTargetInfo) => void;
  onLit?: (m: Mesh | null) => void;
  onError: (e: Error) => void;
}

export default function HeroZone({ store, category, itemName, onTarget, onLit, onError }: HeroZoneProps) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const group = useRef<Group>(null);
  // the zone's programs compile before the camera moves (in parallel where the GPU allows), so the descent
  // never stalls on a shader
  const [compiled, setCompiled] = useState<KitMaterials | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  const zone = useMemo(() => {
    const z = buildBulkZone(store.outline);
    heroStats.triangles = z.triangles;
    return z;
  }, [store]);
  const [tier, setTier] = useState<Tier>(() => pickTier());
  // the dolly in is the first stretch of continuous frames: if hi runs under ~30 fps (median over 34 ms), drop
  // to lo now and on this phone from now on
  const frames = useRef<{ last: number; deltas: number[]; decided: boolean }>({ last: 0, deltas: [], decided: false });
  const [textures, setTextures] = useState<Record<TextureName, Texture> | null>(null);
  useEffect(() => {
    let live = true;
    loadHeroTextures(gl, tier)
      .then((t) => {
        if (!live) return Object.values(t).forEach((x) => x.dispose());
        setTextures((prev) => {
          if (prev) Object.values(prev).forEach((x) => x.dispose()); // the hi set, after a drop to lo
          return t;
        });
      })
      .catch((e: unknown) => live && onError(e instanceof Error ? e : new Error(String(e))));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, tier]);
  const rig = useMemo(() => bulkRig(), []);
  const mats = useMemo<KitMaterials | null>(() => (textures ? kitMaterials(textures, rig) : null), [textures, rig]);
  const decals = useMemo(() => decalMesh(zone.decals), [zone]);
  useFrame(() => {
    const f = frames.current;
    if (!mats || f.decided || tier === "lo" || pinnedTier()) return;
    const now = performance.now();
    if (f.last && now - f.last < 400) f.deltas.push(now - f.last); // idle gaps (on-demand rendering) do not count
    f.last = now;
    if (f.deltas.length < 20) return;
    f.decided = true;
    const median = [...f.deltas].sort((a, b) => a - b)[10];
    if (median > 34) {
      save(TIER_KEY, "lo");
      setTier("lo");
    }
  });

  // static meshes, one per material key
  const statics = useMemo(() => (mats ? [...zone.statics].map(([key, geo]) => new Mesh(geo, mats[key])) : []), [zone, mats]);
  // instanced templates, with their matrices, light and atlas cells
  const instanced = useMemo(() => {
    if (!mats) return new Map<string, { mesh: InstancedMesh; base: Matrix4[] }>();
    const out = new Map<string, { mesh: InstancedMesh; base: Matrix4[] }>();
    for (const set of zone.instances) {
      const n = set.matrices.length;
      if (!n) continue;
      const geo = set.geo.clone();
      if (set.attr) {
        const a = new Float32Array(n * set.attr.size);
        set.attr.values.forEach((v, i) => a.set(v, i * set.attr!.size));
        geo.setAttribute(set.attr.name, new InstancedBufferAttribute(a, set.attr.size));
      }
      const mesh = new InstancedMesh(geo, mats[set.material], n);
      set.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      set.colors.forEach((c, i) => mesh.setColorAt(i, new Color(c[0], c[1], c[2])));
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      // transparent acrylic and glass draw after the grain inside them
      if (set.material === "acrylic") mesh.renderOrder = 2;
      out.set(set.name, { mesh, base: set.matrices.map((m) => m.clone()) });
    }
    return out;
  }, [zone, mats]);

  // leaving the zone frees the GPU: geometry, materials, textures (a phone opens many close-ups in a trip)
  useEffect(
    () => () => {
      for (const g of zone.statics.values()) g.dispose();
      decals.geometry.dispose();
      (decals.material as MeshStandardMaterial).dispose();
    },
    [zone, decals],
  );
  useEffect(
    () => () => {
      for (const { mesh } of instanced.values()) mesh.geometry.dispose();
      if (mats) for (const m of Object.values(mats)) m.dispose();
    },
    [instanced, mats],
  );
  useEffect(
    () => () => {
      if (textures) for (const t of Object.values(textures)) t.dispose();
    },
    [textures],
  );

  // the stop's bin: lifted and pulled toward the shopper, and its lime volume
  const target = useMemo<Target | null>(() => pickTarget(zone.targets, category, itemName), [zone, category, itemName]);
  const lifted = useRef<Target | null>(null);
  useEffect(() => {
    if (!instanced.size) return;
    const move = (t: Target, on: boolean) => {
      for (const p of t.parts) {
        const it = instanced.get(p.set);
        if (!it) continue;
        const m = it.base[p.index].clone();
        if (on) m.premultiply(new Matrix4().makeTranslation(0, LIFT, t.facing * PULL));
        it.mesh.setMatrixAt(p.index, m);
        it.mesh.instanceMatrix.needsUpdate = true;
      }
    };
    if (lifted.current) move(lifted.current, false);
    if (target) move(target, true);
    lifted.current = target;
    invalidate();
  }, [target, instanced, invalidate]);
  // the camera starts down only once there is something to see: the textures are in, the programs compiled
  useEffect(() => {
    if (!mats || !group.current || compiled === mats) return;
    let live = true;
    const done = () => {
      if (!live) return;
      // one draw into a 1 × 1 target, from the door, with the real scene's lights: every buffer and texture
      // goes up to the GPU now, not in the first frame of the descent (that frame took 150 ms on an M4)
      const g = group.current;
      const wrapper = g?.parent;
      if (g && wrapper && target) {
        const was = wrapper.visible;
        wrapper.visible = true;
        const eye = new PerspectiveCamera(80, 1, 0.05, 120);
        eye.position.set(...target.door);
        eye.lookAt(...target.center);
        const rt = new WebGLRenderTarget(1, 1);
        const prev = gl.getRenderTarget();
        gl.setRenderTarget(rt);
        gl.render(scene, eye);
        gl.setRenderTarget(prev);
        rt.dispose();
        wrapper.visible = was;
      }
      setCompiled(mats);
    };
    gl.compileAsync(group.current, camera, scene).then(done, done);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mats, gl, camera, scene, compiled, instanced]);
  useEffect(() => {
    if (target && mats && compiled === mats) onTarget({ center: target.center, facing: target.facing, name: target.name, bounds: zone.bounds, door: target.door });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, zone, mats, compiled]);

  const lit = useMemo(() => {
    if (!target) return null;
    const [w, h, d] = target.size;
    const geo = new BoxGeometry(w, h, d);
    geo.translate(target.center[0], target.center[1] + LIFT, target.center[2] + target.facing * PULL);
    const mat = new MeshStandardMaterial({ color: LIME, emissive: LIME, emissiveIntensity: 0.2, transparent: true, opacity: 0.05, depthWrite: false, roughness: 0.6 });
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = 10;
    const pos = new EdgesGeometry(geo).attributes.position;
    const rim: [number, number, number][] = [];
    for (let i = 0; i < pos.count; i++) rim.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
    return { mesh, rim };
  }, [target]);
  useEffect(() => {
    onLit?.(lit?.mesh ?? null);
    return () => onLit?.(null);
  }, [lit, onLit]);

  // the target's own grains, real and in 3D, on its visible surface; lifted with it
  const grains = useMemo(() => {
    if (!target || !mats) return null;
    const layer = grainLayer({ surface: grainSurface(target), shape: shapeOf(target.grain), tint: hex(GRAINS[target.grain].tint) }, mats.grainSolid, target.name.length * 31);
    if (!layer) return null;
    const g = new Group();
    g.add(layer);
    g.position.set(0, LIFT, target.facing * PULL);
    return g;
  }, [target, mats]);
  useEffect(
    () => () => {
      grains?.traverse((o) => (o as Mesh).geometry?.dispose());
    },
    [grains],
  );

  useEffect(() => {
    if (mats) invalidate();
  }, [mats, invalidate]);

  if (!mats) return null;
  return (
    <group name="hero-bulk" ref={group}>
      {/* the ambient: warm bounce from the clay above, the floor below */}
      <hemisphereLight args={["#FFE4C8", "#B08A6A", 1.7]} />
      <primitive object={decals} />
      {grains && <primitive object={grains} />}
      {statics.map((m, i) => (
        <primitive key={`s${i}`} object={m} />
      ))}
      {[...instanced.values()].map(({ mesh }) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
      {lit && (
        <group name="hero-lit">
          <primitive object={lit.mesh} />
          <Line segments points={lit.rim} color="#D4FF4A" lineWidth={2} toneMapped={false} renderOrder={11} />
        </group>
      )}
    </group>
  );
}
