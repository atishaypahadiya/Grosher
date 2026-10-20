// A standard close-up (its own lazy chunk, shared by every standard zone): the generated faces of zone.ts as
// meshes on the kit's materials, the shadow decals, the stop's slot lit lime. The textures and the shader
// programs are shared by every standard zone of the trip (kit/materials.ts standardTextures), so after the
// first only the geometry is new. Mounted by the 3D map while its close-up is open or being prepared.

import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { BoxGeometry, Color, EdgesGeometry, Group, Mesh, MeshStandardMaterial, type Texture } from "three";
import type { StoreGraph } from "@grosher/core";
import { decalMesh } from "../kit/decals.ts";
import { bakeEnv } from "../kit/env.ts";
import { pickTier, standardMaterials, standardTextures, type KitMaterials, type StandardTextureName } from "../kit/materials.ts";
import { warmUp } from "../kit/warm.ts";
import type { HeroZoneComponentProps, HeroZoneEntry } from "../index.ts";
import { heroStats } from "../stats.ts";
import { dropStandardZone, standardZoneFor } from "./zone.ts";

const LIME = new Color("#D4FF4A");

export default function StandardZone({ store, zone, itemName, active = true, onTarget, onLit, onError }: HeroZoneComponentProps) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const group = useRef<Group>(null);
  const plan = zone.plan!;
  const build = useMemo(() => {
    const z = standardZoneFor(store, zone.categories ?? [], plan);
    heroStats.triangles = z.triangles;
    return z;
  }, [store, plan]);
  const [textures, setTextures] = useState<Record<StandardTextureName, Texture> | null>(null);
  useEffect(() => {
    let live = true;
    standardTextures(pickTier(), gl)
      .then((t) => live && setTextures(t))
      .catch((e: unknown) => live && onError(e instanceof Error ? e : new Error(String(e))));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);
  const env = useMemo(() => {
    const e = bakeEnv(gl);
    heroStats.envBytes = e.bytes;
    return e;
  }, [gl]);
  useEffect(() => () => env.dispose(), [env]);
  const mats = useMemo<Partial<KitMaterials> | null>(() => (textures ? standardMaterials(textures, build.rig, env.texture) : null), [textures, build, env]);
  const decals = useMemo(() => decalMesh(build.decals), [build]);
  const statics = useMemo(() => (mats ? [...build.statics].flatMap(([key, geo]) => (mats[key] ? [new Mesh(geo, mats[key])] : [])) : []), [build, mats]);
  // leaving frees the zone's own GPU memory (the shared textures stay for the next standard close-up)
  useEffect(
    () => () => {
      for (const g of build.statics.values()) g.dispose();
      decals.geometry.dispose();
      (decals.material as MeshStandardMaterial).dispose();
      dropStandardZone(store, plan);
    },
    [build, decals, store, plan],
  );
  useEffect(
    () => () => {
      if (mats) for (const m of Object.values(mats)) m?.dispose();
    },
    [mats],
  );

  const t = build.target;
  const [compiled, setCompiled] = useState<object | null>(null);
  useEffect(() => {
    if (!mats || !group.current || compiled === mats) return;
    return warmUp(gl, scene, camera, group.current, { from: t.door, at: t.center }, textures ? Object.values(textures) : [], () => setCompiled(mats));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mats, gl, camera, scene, compiled]);
  useEffect(() => {
    if (active && mats && compiled === mats) onTarget({ center: t.center, facing: 1, out: t.out, axis: t.axis, height: t.size[1], side: t.side, name: itemName, bounds: t.bounds, door: t.door, via: t.via, stand: t.stand });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build, mats, compiled, active]);

  const lit = useMemo(() => {
    const [w, h, d] = t.size;
    const geo = new BoxGeometry(w, h, d);
    geo.rotateY(t.rotY);
    geo.translate(t.center[0], t.center[1], t.center[2]);
    const mat = new MeshStandardMaterial({ color: LIME, emissive: LIME, emissiveIntensity: 0.2, transparent: true, opacity: 0.06, depthWrite: false, roughness: 0.6 });
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = 10;
    const pos = new EdgesGeometry(geo).attributes.position;
    const rim: [number, number, number][] = [];
    for (let i = 0; i < pos.count; i++) rim.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
    return { mesh, rim };
  }, [t]);
  useEffect(() => {
    onLit?.(lit.mesh);
    return () => onLit?.(null);
  }, [lit, onLit]);
  useEffect(() => {
    if (mats) invalidate();
  }, [mats, invalidate]);

  if (!mats) return null;
  return (
    <group name={`hero-${zone.id}`} ref={group}>
      <primitive object={decals} />
      {statics.map((m, i) => (
        <primitive key={`s${i}`} object={m} />
      ))}
      <group name="hero-lit">
        <primitive object={lit.mesh} />
        <Line segments points={lit.rim} color="#D4FF4A" lineWidth={2} toneMapped={false} renderOrder={11} />
      </group>
    </group>
  );
}

/** Prepared ahead (the list screen, for the route's first stop): the geometry built and the textures in. */
export async function prepare(store: StoreGraph, zone: HeroZoneEntry): Promise<void> {
  if (zone.plan) standardZoneFor(store, zone.categories ?? [], zone.plan);
  await standardTextures(pickTier()).catch(() => undefined);
}
export function unprepare() {}
