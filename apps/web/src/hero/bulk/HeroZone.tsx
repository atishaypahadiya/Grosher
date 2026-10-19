// The Bulk & pulses zone at full detail (its own lazy chunk): the shelf kit's meshes for zone.ts, the hero
// textures, the stop's bin lifted a little and lit lime, and the zone's two realtime lights (the warm pools
// are baked). Mounted by the 3D map only while a close-up is open in this zone.

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { BoxGeometry, Color, EdgesGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Object3D, Vector3, type Texture } from "three";
import type { StoreGraph } from "@grosher/core";
import { buildBulkZone, pickTarget, type Target } from "./zone.ts";
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
  const mats = useMemo<KitMaterials | null>(() => (textures ? kitMaterials(textures) : null), [textures]);
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
      const cells = new Float32Array(n * 4);
      set.cells!.forEach((c, i) => cells.set(c, i * 4));
      geo.setAttribute("aCell", new InstancedBufferAttribute(cells, 4));
      const mesh = new InstancedMesh(geo, mats[set.material], n);
      set.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      set.colors.forEach((c, i) => mesh.setColorAt(i, new Color(c[0], c[1], c[2])));
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      // transparent acrylic and glass draw after the grain inside them
      if (set.material === "acrylic" || set.material === "glass") mesh.renderOrder = 2;
      out.set(set.name, { mesh, base: set.matrices.map((m) => m.clone()) });
    }
    return out;
  }, [zone, mats]);

  // leaving the zone frees the GPU: geometry, materials, textures (a phone opens many close-ups in a trip)
  useEffect(
    () => () => {
      for (const g of zone.statics.values()) g.dispose();
    },
    [zone],
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
  // the camera starts down only once there is something to see: the textures are in
  useEffect(() => {
    if (target && mats) onTarget({ center: target.center, facing: target.facing, name: target.name, bounds: zone.bounds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, zone, mats]);

  const lit = useMemo(() => {
    if (!target) return null;
    const [w, h, d] = target.size;
    const geo = new BoxGeometry(w, h, d);
    geo.translate(target.center[0], target.center[1] + LIFT, target.center[2] + target.facing * PULL);
    const mat = new MeshStandardMaterial({ color: LIME, emissive: LIME, emissiveIntensity: 0.35, transparent: true, opacity: 0.13, depthWrite: false, roughness: 0.6 });
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

  // the key light: from above the aisle, a little toward the shelf, so the grain and plaster show relief
  const keyTarget = useMemo(() => {
    const o = new Object3D();
    o.position.set(...(target?.center ?? [59, 1, 2]));
    return o;
  }, [target]);
  const keyPos = useMemo(() => new Vector3((target?.center[0] ?? 59) - 1.2, 4.2, (target?.center[2] ?? 2) + (target?.facing ?? 1) * 2.4), [target]);

  useEffect(() => {
    if (mats) invalidate();
  }, [mats, invalidate]);

  if (!mats) return null;
  return (
    <group name="hero-bulk">
      <hemisphereLight args={["#FFE7CF", "#4A3528", 0.95]} />
      <primitive object={keyTarget} />
      <directionalLight position={keyPos} target={keyTarget} intensity={0.75} color="#FFD9AE" />
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
