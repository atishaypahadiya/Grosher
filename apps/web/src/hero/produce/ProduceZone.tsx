// The Produce zone at full detail (its own lazy chunk): zone.ts's meshes on the produce materials, the
// fruit and stock one by one around the stop (zone.ts `selectDetail`), the stop's crates or deck lit lime and
// their produce lifted a little, faint shafts of daylight and the misting bars' pulse. Mounted by the 3D map
// while a close-up is open in this zone or being prepared; on the GPU only once it may be (`upload`,
// kit/warm.ts), and off it, textures and geometry, as soon as it unmounts.

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { AdditiveBlending, BoxGeometry, Color, DoubleSide, EdgesGeometry, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, ShaderMaterial, type Object3D, type Texture } from "three";
import type { StoreGraph } from "@grosher/core";
import { compileZone, unloadZone, uploadZone } from "../kit/warm.ts";
import { decalMesh } from "../kit/decals.ts";
import { acquireEnv } from "../kit/env.ts";
import { dropPreparedTextures, loadHeroTextures, pickTier, pinnedTier, prepareHeroTextures, produceMaterials, TIER_KEY, type ProduceMaterials, type ProduceTextureName, type Tier } from "../kit/materials.ts";
import { save } from "../../lib/storage.ts";
import type { HeroZoneComponentProps } from "../index.ts";
import { heroStats, zoneState } from "../stats.ts";
import { fruitShape } from "./fruit.ts";
import { dropProduceZone, pickProduceTarget, produceRig, produceZoneFor, selectDetail, walkOver, WALK_SPEED, type ProduceTarget } from "./zone.ts";

const LIME = new Color("#D4FF4A");
const LIFT = 0.03;
const PULL = 0.05;
/** the misting bars: a puff every 20 s, 3 s long */
const MIST_EVERY = 20_000;
const MIST_MS = 3_000;

export default function ProduceZone({ store, zone: entry, category, itemName, active = true, upload = active, onTarget, onLit, onError }: HeroZoneComponentProps) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const group = useRef<Group>(null);
  const build = useMemo(() => produceZoneFor(store), [store]);
  const rig = useMemo(() => produceRig(), []);
  const [tier, setTier] = useState<Tier>(() => pickTier());
  const frames = useRef<{ last: number; deltas: number[]; decided: boolean }>({ last: 0, deltas: [], decided: false });
  const [textures, setTextures] = useState<Record<ProduceTextureName, Texture> | null>(null);
  useEffect(() => {
    let live = true;
    loadHeroTextures(gl, tier, "produce")
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
  // the gloss's environment, shared with the other zone mounted (kit/env.ts)
  const [env, setEnv] = useState<Texture | null>(null);
  useEffect(() => {
    const e = acquireEnv(gl);
    setEnv(e.texture);
    return e.release;
  }, [gl]);
  const mats = useMemo<ProduceMaterials | null>(() => (textures && env ? produceMaterials(textures, rig, env, fruitShape) : null), [textures, rig, env]);
  const decals = useMemo(() => decalMesh(build.decals), [build]);
  // the dolly in is the first stretch of continuous frames: under ~30 fps on hi, drop to lo (as Bulk)
  useFrame(() => {
    const f = frames.current;
    if (!active || !mats || f.decided || tier === "lo" || pinnedTier()) return;
    const now = performance.now();
    if (f.last && now - f.last < 400) f.deltas.push(now - f.last);
    f.last = now;
    if (f.deltas.length < 20) return;
    f.decided = true;
    const median = [...f.deltas].sort((a, b) => a - b)[10];
    if (median > 34) {
      save(TIER_KEY, "lo");
      setTier("lo");
    }
  });

  const statics = useMemo(() => (mats ? [...build.statics].map(([key, geo]) => new Mesh(geo, mats[key])) : []), [build, mats]);
  // the stop's display, and what is drawn one by one around it
  const target = useMemo<ProduceTarget | null>(() => pickProduceTarget(build.targets, category, itemName), [build, category, itemName]);
  const selection = useMemo(() => (target ? selectDetail(build, target) : null), [build, target]);
  const instanced = useMemo(() => {
    const out = new Map<string, { mesh: InstancedMesh; base: Matrix4[] }>();
    if (!mats || !selection) return out;
    const c = new Color();
    for (const spec of build.specs) {
      const list = selection.sets.get(spec.name)!;
      if (!list.length) continue;
      const geo = spec.geo.clone();
      for (const a of spec.attrs) {
        const arr = new Float32Array(list.length * a.size);
        list.forEach((it, i) => it.attrs?.[a.name] && arr.set(it.attrs[a.name], i * a.size));
        geo.setAttribute(a.name, new InstancedBufferAttribute(arr, a.size));
      }
      const mesh = new InstancedMesh(geo, mats[spec.material], list.length);
      list.forEach((it, i) => {
        mesh.setMatrixAt(i, it.m);
        mesh.setColorAt(i, c.setRGB(it.color[0], it.color[1], it.color[2]));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = `produce-${spec.name}`;
      // clear plastic and glass after what is inside them
      if (spec.material === "clear") mesh.renderOrder = 2;
      out.set(spec.name, { mesh, base: list.map((it) => it.m) });
    }
    heroStats.triangles = build.triangles + selection.detail;
    return out;
  }, [build, mats, selection]);
  useEffect(
    () => () => {
      for (const { mesh } of instanced.values()) mesh.geometry.dispose();
    },
    [instanced],
  );
  // the stop's crates (or deck) and what is in them: lifted a little toward the shopper
  useEffect(() => {
    if (!selection || !target) return;
    const up = new Matrix4().makeTranslation(0, LIFT, target.facing * PULL);
    for (const { set, index } of selection.lift) {
      const it = instanced.get(set);
      if (!it) continue;
      it.mesh.setMatrixAt(index, it.base[index].clone().premultiply(up));
      it.mesh.instanceMatrix.needsUpdate = true;
    }
    invalidate();
  }, [selection, target, instanced, invalidate]);

  // leaving the zone frees the GPU: geometry, materials, textures
  useEffect(
    () => () => {
      for (const g of build.statics.values()) g.dispose();
      decals.geometry.dispose();
      (decals.material as MeshStandardMaterial).dispose();
    },
    [build, decals],
  );
  useEffect(
    () => () => {
      if (mats) for (const m of Object.values(mats)) m.dispose();
    },
    [mats],
  );
  useEffect(
    () => () => {
      if (textures) for (const t of Object.values(textures)) t.dispose();
    },
    [textures],
  );

  // shafts of daylight and the misting plumes: additive, their own two draw calls
  const shafts = useMemo(() => {
    const m = new Mesh(
      build.shafts,
      new ShaderMaterial({
        uniforms: { uK: { value: 0.03 } },
        vertexShader: /* glsl */ `varying vec2 vUv; varying float vDepth; void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */ `
          uniform float uK;
          varying vec2 vUv;
          varying float vDepth;
          void main() {
            float edge = smoothstep(0.0, 0.4, vUv.x) * smoothstep(1.0, 0.6, vUv.x);
            // a shaft shows from a distance, never as a veil over what the shopper is looking at
            float far = smoothstep(2.5, 7.0, vDepth);
            float a = vUv.y * vUv.y * edge * uK * far;
            gl_FragColor = vec4(vec3(1.0, 0.985, 0.95) * a, 1.0);
          }`,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    );
    m.renderOrder = 5;
    m.frustumCulled = false;
    m.name = "produce-shafts";
    return m;
  }, [build]);
  const mist = useMemo(() => {
    const m = new Mesh(
      build.mist,
      new ShaderMaterial({
        uniforms: { uPulse: { value: 0 }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uPulse;
          uniform float uTime;
          varying vec2 vUv;
          float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
          void main() {
            float v = fract(vUv.y);
            float k = n(vec2(vUv.x * 7.0 + uTime * 0.2, vUv.y * 5.0 - uTime * 0.9)) * 0.6 + n(vec2(vUv.x * 19.0, vUv.y * 13.0 - uTime * 1.7)) * 0.4;
            float a = uPulse * smoothstep(0.0, 0.7, v) * smoothstep(0.2, 0.8, k) * 0.2;
            gl_FragColor = vec4(vec3(a), 1.0);
          }`,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    );
    m.renderOrder = 6;
    m.visible = false;
    m.name = "produce-mist";
    return m;
  }, [build]);
  useEffect(
    () => () => {
      (shafts.material as ShaderMaterial).dispose();
      (mist.material as ShaderMaterial).dispose();
    },
    [shafts, mist],
  );
  // the mist's pulse: only while the close-up is open, never under reduced motion; frames only while it puffs
  const reduced = useMemo(() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const pulse = useRef<{ t0: number } | null>(null);
  useEffect(() => {
    if (!active || reduced || !mats) return;
    const start = () => {
      pulse.current = { t0: performance.now() };
      invalidate();
    };
    const first = window.setTimeout(start, 4000);
    const every = window.setInterval(start, MIST_EVERY);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      pulse.current = null;
      mist.visible = false;
    };
  }, [active, reduced, mats, mist, invalidate]);
  useFrame(() => {
    const p = pulse.current;
    if (!p) return;
    const t = (performance.now() - p.t0) / MIST_MS;
    const u = (mist.material as ShaderMaterial).uniforms;
    if (t >= 1) {
      pulse.current = null;
      mist.visible = false;
      u.uPulse.value = 0;
      invalidate();
      return;
    }
    mist.visible = true;
    u.uPulse.value = Math.sin(Math.PI * t) ** 2;
    u.uTime.value = performance.now() / 1000;
    invalidate();
  });

  // prepared: the programs compile now; the textures and buffers go up only once the zone may be resident
  const [compiled, setCompiled] = useState<ProduceMaterials | null>(null);
  useEffect(() => {
    if (!mats || !group.current || compiled === mats || !target) return;
    let live = true;
    void compileZone(gl, scene, camera, group.current).then(() => {
      if (!live) return;
      setCompiled(mats);
      if (!heroStats.zones[entry.id]) zoneState(entry.id, "prepared");
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mats, gl, camera, scene, compiled, instanced]);
  const [uploaded, setUploaded] = useState<ProduceMaterials | null>(null);
  useEffect(() => {
    if (!upload || !mats || compiled !== mats || !group.current || !target) return;
    const g = group.current;
    const list = textures ? Object.values(textures) : [];
    const stand: [number, number, number] = [target.center[0] + target.side, 1.6, target.center[2] + target.facing * target.stand];
    // on the GPU, the room's own gloss: daylight (compiled with the shared warm one, the same size)
    const day = acquireEnv(gl, "daylight");
    const glossy = Object.values(mats).filter((m) => (m as MeshStandardMaterial).envMap) as MeshStandardMaterial[];
    for (const m of glossy) m.envMap = day.texture;
    uploadZone(gl, scene, g, { from: stand, at: target.center }, list);
    setUploaded(mats);
    zoneState(entry.id, "uploaded");
    invalidate();
    // no longer allowed on the GPU (or unmounted): off it at once
    return () => {
      setUploaded(null);
      zoneState(entry.id, "prepared");
      unloadZone(g, list);
      if (env) for (const m of glossy) m.envMap = env;
      day.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload, mats, compiled]);
  useEffect(() => {
    if (active && selection) heroStats.triangles = build.triangles + selection.detail;
    // prepared in the background, it waits; made active (its stop is next), it hands over at once
    if (active && target && mats && uploaded === mats)
      onTarget({
        center: target.center,
        facing: target.facing,
        out: [0, target.facing],
        axis: [1, 0],
        name: target.name,
        height: target.size[1],
        side: target.side,
        bounds: target.bounds,
        door: target.door,
        via: target.via,
        stand: target.stand,
        descent: target.descent,
        walkSpeed: WALK_SPEED,
        over: (from) => walkOver(from, { x: target.center[0] + target.side, walkZ: target.walkZ }),
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, build, mats, uploaded, active]);
  // after the upload's cleanup (effects are torn down in order): unmounted, the zone is gone
  useEffect(() => () => zoneState(entry.id, null), [entry.id]);

  // the lime outline round the stop's crates or deck: the rim is what blooms (a display is a metre or more
  // across: a lit volume that size, blooming, hazed the whole of it), the volume itself barely there
  const rimRef = useRef<Object3D>(null);
  const lit = useMemo(() => {
    if (!target) return null;
    const [w, h, d] = target.size;
    const geo = new BoxGeometry(w, h, d);
    geo.translate(target.center[0], target.center[1] + LIFT, target.center[2] + target.facing * PULL);
    const mat = new MeshStandardMaterial({ color: LIME, emissive: LIME, emissiveIntensity: 0.05, transparent: true, opacity: 0.02, depthWrite: false, roughness: 0.6 });
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = 10;
    const pos = new EdgesGeometry(geo).attributes.position;
    const rim: [number, number, number][] = [];
    for (let i = 0; i < pos.count; i++) rim.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
    return { mesh, rim };
  }, [target]);
  useEffect(() => {
    onLit?.((rimRef.current as Mesh | null) ?? null);
    return () => onLit?.(null);
  }, [lit, onLit, mats]);
  useEffect(
    () => () => {
      lit?.mesh.geometry.dispose();
      (lit?.mesh.material as MeshStandardMaterial | undefined)?.dispose();
    },
    [lit],
  );

  useEffect(() => {
    if (mats) invalidate();
  }, [mats, invalidate]);

  if (!mats) return null;
  return (
    <group name="hero-produce" ref={group}>
      <primitive object={decals} />
      {statics.map((m, i) => (
        <primitive key={`s${i}`} object={m} />
      ))}
      {[...instanced.values()].map(({ mesh }) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
      <primitive object={shafts} />
      <primitive object={mist} />
      {lit && (
        <group name="hero-lit">
          <primitive object={lit.mesh} />
          <Line ref={rimRef as never} segments points={lit.rim} color="#D4FF4A" lineWidth={2} toneMapped={false} renderOrder={11} />
        </group>
      )}
    </group>
  );
}

/**
 * Prepared ahead, before the trip's 3D canvas exists (the list screen, when the route's first stop is in this
 * zone): the zone's geometry built and kept, its textures fetched and transcoded for this device.
 */
export async function prepare(store: StoreGraph): Promise<void> {
  produceZoneFor(store);
  await prepareHeroTextures(pickTier(), "produce");
}
/** The route changed: drop what was prepared and not taken. */
export function unprepare() {
  dropPreparedTextures("produce");
  dropProduceZone();
}
