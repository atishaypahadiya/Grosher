// A standard close-up (its own lazy chunk, shared by every standard zone): the generated faces of zone.ts as
// meshes on the kit's materials, the shadow decals, the stop's slot lit lime. The textures and the shader
// programs are shared by every standard zone of the trip (kit/materials.ts standardTextures), so after the
// first only the geometry is new. Mounted by the 3D map while its close-up is open or being prepared; on the
// GPU only once it may be (`upload`, kit/warm.ts), and off it as soon as it unmounts.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { BoxGeometry, Color, EdgesGeometry, Group, Mesh, MeshStandardMaterial, type Texture } from "three";
import type { StoreGraph } from "@grosher/core";
import { decalMesh } from "../kit/decals.ts";
import { acquireEnv } from "../kit/env.ts";
import { holdStandardGpu, pickTier, standardMaterials, standardTextures, type KitMaterials, type StandardTextureName } from "../kit/materials.ts";
import { compileZone, unloadZone, uploadZone } from "../kit/warm.ts";
import type { HeroZoneComponentProps, HeroZoneEntry } from "../index.ts";
import { heroStats, zoneState } from "../stats.ts";
import { dropStandardZone, standardZoneFor } from "./zone.ts";

const LIME = new Color("#D4FF4A");

export default function StandardZone({ store, zone, itemName, active = true, upload = active, onTarget, onLit, onError }: HeroZoneComponentProps) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const group = useRef<Group>(null);
  const plan = zone.plan!;
  const build = useMemo(() => standardZoneFor(store, zone.categories ?? [], plan), [store, plan]);
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
  // the gloss's environment, shared with the other zone mounted (kit/env.ts)
  const [env, setEnv] = useState<Texture | null>(null);
  useEffect(() => {
    const e = acquireEnv(gl);
    setEnv(e.texture);
    return e.release;
  }, [gl]);
  const mats = useMemo<Partial<KitMaterials> | null>(() => (textures && env ? standardMaterials(textures, build.rig, env) : null), [textures, build, env]);
  const decals = useMemo(() => decalMesh(build.decals), [build]);
  const statics = useMemo(() => (mats ? [...build.statics].flatMap(([key, geo]) => (mats[key] ? [new Mesh(geo, mats[key])] : [])) : []), [build, mats]);
  // leaving frees the zone's own memory (the shared textures go with the last standard zone: the hold below)
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
  // prepared: the programs compile now; the textures and buffers go up only once the zone may be resident
  const [compiled, setCompiled] = useState<object | null>(null);
  useEffect(() => {
    if (!mats || !group.current || compiled === mats) return;
    let live = true;
    void compileZone(gl, scene, camera, group.current).then(() => {
      if (!live) return;
      setCompiled(mats);
      if (!heroStats.zones[zone.id]) zoneState(zone.id, "prepared");
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mats, gl, camera, scene, compiled]);
  // the shared textures stay on the GPU while a standard zone may be there, freed with the last one. Taken in
  // the layout phase and let go in the passive one: a standard zone opening next holds them before the one it
  // replaces lets go, in the same commit, so they are never freed and uploaded again between the two
  const hold = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (upload) hold.current ??= holdStandardGpu();
  }, [upload]);
  useEffect(() => {
    if (!upload) return;
    hold.current ??= holdStandardGpu();
    return () => {
      hold.current?.();
      hold.current = null;
    };
  }, [upload]);
  const [uploaded, setUploaded] = useState<object | null>(null);
  useEffect(() => {
    if (!upload || !mats || compiled !== mats || !group.current) return;
    const g = group.current;
    uploadZone(gl, scene, g, { from: t.door, at: t.center }, textures ? Object.values(textures) : []);
    setUploaded(mats);
    zoneState(zone.id, "uploaded");
    invalidate();
    // no longer allowed on the GPU (or unmounted): its buffers off it at once
    return () => {
      setUploaded(null);
      zoneState(zone.id, "prepared");
      unloadZone(g, []);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload, mats, compiled]);
  useEffect(() => {
    if (active) heroStats.triangles = build.triangles;
    if (active && mats && uploaded === mats) onTarget({ center: t.center, facing: 1, out: t.out, axis: t.axis, height: t.size[1], side: t.side, name: itemName, bounds: t.bounds, door: t.door, via: t.via, stand: t.stand });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build, mats, uploaded, active]);
  // after the upload's cleanup (effects are torn down in order): unmounted, the zone is gone
  useEffect(() => () => zoneState(zone.id, null), [zone.id]);

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
  useEffect(
    () => () => {
      lit.mesh.geometry.dispose();
      (lit.mesh.material as MeshStandardMaterial).dispose();
    },
    [lit],
  );
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
