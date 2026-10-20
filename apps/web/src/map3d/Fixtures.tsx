// Fixtures: detailed geometry per department fixture kind (gondola, cold
// case, produce table, bakery table, counter, service case, coffin, bins),
// merged per department into one opaque mesh (department texture on the
// visible faces), one glass mesh, one frame mesh and one glow mesh where the
// kind needs them, plus one hull outline batch and one atlas mesh for the
// aisle signs. A department with a finish (Grosher: wood, stainless) is
// merged with every other department of that finish instead, its body in the
// finish's material and its uprights and rails in black steel under wood.
// The next stop's slot is lit separately (LitSlot).

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BoxGeometry, Color, DoubleSide, EdgesGeometry, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader, type BufferGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useLoader } from "@react-three/fiber";
import type { Department, GraphNode, StoreGraph } from "@grosher/core";
import { fixtureParams, frontSignOf, type FixtureParams } from "@grosher/stores";
import { type Box, fixtureBox, frontOf } from "./layout.ts";
import { buildSignAtlas } from "./signs.ts";
import { generate } from "./fixtures/generators.ts";
import { emptyParts, type Parts } from "./fixtures/parts.ts";

const EDGE_WHITE = new LineBasicMaterial({ color: "#FFFFFF", transparent: true, opacity: 0.35 });
const GLASS = new MeshStandardMaterial({ color: "#E8F4F6", transparent: true, opacity: 0.32, roughness: 0.08, metalness: 0.05, depthWrite: false });
const FRAME = new MeshStandardMaterial({ color: "#F3F7F7", roughness: 0.6 });
const GLOW = new MeshStandardMaterial({ color: "#F4FBFC", emissive: new Color("#DDF2F5"), emissiveIntensity: 0.45, roughness: 1 });
// black steel: the uprights, end panels and rails of the wood-finish fixtures
const STEEL = new MeshStandardMaterial({ color: "#2A2824", roughness: 0.45, metalness: 0.35 });
const FINISH_FILE = { wood: "wood.jpg", stainless: "stainless.jpg" } as const;

/**
 * Neutral light for the fresh and cold zones: the scene's light is the haze (an orange hemisphere sky and a
 * warm key), which turns pale steel peach. This material keeps the light's strength but drops its colour
 * (every light term reduced to its luminance), so stainless and the cold-case frames read as brushed steel
 * while the background, the sky and the wood stay warm. One extra shader program, no extra draw calls.
 */
function neutralLight<M extends MeshStandardMaterial>(m: M): M {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_fragment_end>",
      `#include <lights_fragment_end>
      {
        const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
        reflectedLight.directDiffuse = vec3(dot(reflectedLight.directDiffuse, LUMA));
        reflectedLight.indirectDiffuse = vec3(dot(reflectedLight.indirectDiffuse, LUMA));
        reflectedLight.directSpecular = vec3(dot(reflectedLight.directSpecular, LUMA));
        reflectedLight.indirectSpecular = vec3(dot(reflectedLight.indirectSpecular, LUMA));
      }`,
    );
  };
  m.customProgramCacheKey = () => "grosher-neutral-light";
  return m;
}
const FRAME_STEEL = neutralLight(new MeshStandardMaterial({ color: "#E4E6E3", roughness: 0.35 }));
const GLOW_STEEL = neutralLight(new MeshStandardMaterial({ color: "#F2F3F1", emissive: new Color("#E6E8E5"), emissiveIntensity: 0.45, roughness: 1 }));
type Finish = keyof typeof FINISH_FILE;

function hullGeometry(b: Box) {
  const g = new BoxGeometry(b.w, b.h, b.d);
  g.translate(b.cx, b.h / 2, b.cz);
  return g;
}

function tint(hex: string) {
  // department hex at 70% over white, so the photo's own grade shows through
  return new Color("#FFFFFF").lerp(new Color(hex), 0.7);
}

const merge = (gs: BufferGeometry[]) => (gs.length ? mergeGeometries(gs, false) : null);

// ---------------------------------------------------------------- geometry, cached per store (module scope)

/** Every fixture's detailed parts, once per store map. */
const BUILT = new WeakMap<StoreGraph, Map<number, Built[]>>();
function builtFor(store: StoreGraph, repeatMeters: number): Built[] {
  let byRepeat = BUILT.get(store);
  if (!byRepeat) BUILT.set(store, (byRepeat = new Map()));
  let built = byRepeat.get(repeatMeters);
  if (built) return built;
  const departments = store.departments ?? [];
  const all = store.fixtures ?? [];
  const centre = { x: 0, y: 0 };
  if (all.length) {
    centre.x = all.reduce((s, f) => s + fixtureBox(f).cx, 0) / all.length;
    centre.y = all.reduce((s, f) => s + fixtureBox(f).cz, 0) / all.length;
  }
  built = all.map((f) => {
    const p = fixtureParams(f, departments);
    const hull = fixtureBox(f);
    // a wall run opens toward the store centre: local +z is map +z for horizontal runs, map −x for vertical (rotateY(−π/2) maps local z → map −x)
    const towardCentre: 1 | -1 = p.vertical ? (centre.x < p.cx ? 1 : -1) : centre.y > p.cz ? 1 : -1;
    const parts = generate(p, repeatMeters, { wall: f.kind === "wall", towardCentre, frontSign: frontSignOf(p, store) });
    return { f, p, hull, parts };
  });
  byRepeat.set(repeatMeters, built);
  return built;
}

/** One department's (or one finish's) merged geometry, for a given set of its fixtures. */
interface Merged {
  /** the department id, or `finish:<name>` */
  key: string;
  /** the department key and the fixtures merged: the cache's key */
  id: string;
  finish: Finish | null;
  opaque: BufferGeometry | null;
  trim: BufferGeometry | null;
  glass: BufferGeometry | null;
  frame: BufferGeometry | null;
  glow: BufferGeometry | null;
}
const MERGED = new WeakMap<StoreGraph, Map<string, Merged>>();
/** The store's merged departments with the fixtures in `hideKey` ("a|b|c") left out. */
function mergedFor(store: StoreGraph, repeatMeters: number, hideKey: string): Merged[] {
  let cache = MERGED.get(store);
  if (!cache) MERGED.set(store, (cache = new Map()));
  const departments = store.departments ?? [];
  const hidden = new Set(hideKey ? hideKey.split("|") : []);
  const byKey = new Map<string, Built[]>();
  for (const b of builtFor(store, repeatMeters)) {
    if (hidden.has(b.f.id)) continue;
    const finish = departments.find((d) => d.id === b.f.department)?.finish;
    const k = finish ? `finish:${finish}` : b.f.department ?? "_none";
    byKey.set(k, [...(byKey.get(k) ?? []), b]);
  }
  const out: Merged[] = [];
  for (const [k, list] of byKey) {
    const id = `${repeatMeters}:${k}#${list.map((b) => b.f.id).join(",")}`;
    let m = cache.get(id);
    if (!m) {
      const finish = k.startsWith("finish:") ? (k.slice(7) as Finish) : null;
      const parts = emptyParts();
      for (const b of list) {
        parts.opaque.push(...b.parts.opaque);
        // steel trim is its own mesh only under wood; everywhere else it is part of the body
        (finish === "wood" ? parts.trim : parts.opaque).push(...b.parts.trim);
        parts.glass.push(...b.parts.glass);
        parts.frame.push(...b.parts.frame);
        parts.glow.push(...b.parts.glow);
      }
      m = { key: k, id, finish, opaque: merge(parts.opaque), trim: merge(parts.trim), glass: merge(parts.glass), frame: merge(parts.frame), glow: merge(parts.glow) };
      cache.set(id, m);
    }
    out.push(m);
  }
  return out;
}

const EDGES = new WeakMap<StoreGraph, Map<string, BufferGeometry | null>>();
function edgesGeometryFor(store: StoreGraph, repeatMeters: number, hideKey: string): BufferGeometry | null {
  let cache = EDGES.get(store);
  if (!cache) EDGES.set(store, (cache = new Map()));
  const key = `${repeatMeters}:${hideKey}`;
  if (cache.has(key)) return cache.get(key)!;
  const hidden = new Set(hideKey ? hideKey.split("|") : []);
  const hulls = merge(builtFor(store, repeatMeters).filter((b) => !hidden.has(b.f.id)).map((b) => hullGeometry(b.hull)));
  const geo = hulls ? new EdgesGeometry(hulls) : null;
  cache.set(key, geo);
  return geo;
}

/**
 * The 3D map's fixture geometry, prepared before the map exists (the list screen, idle time, when the route
 * starts in a hero zone): the whole store merged, and merged again without `hide` (the close-up's own and its
 * backdrop's fixtures), so the trip's first frame and the switch into the close-up only wrap cached geometry.
 */
export function prepareFixtures(store: StoreGraph, repeatMeters: number, hide: string[]) {
  mergedFor(store, repeatMeters, "");
  edgesGeometryFor(store, repeatMeters, "");
  const key = hide.join("|");
  mergedFor(store, repeatMeters, key);
  edgesGeometryFor(store, repeatMeters, key);
}

export interface FixturesProps {
  store: StoreGraph;
  textureUrl: (file: string) => string;
  repeatMeters?: number;
  nodes: Map<string, GraphNode>;
  fromEntrance: Map<string, number>;
  /** fixtures to leave out (a hero close-up draws its own in their place) */
  hide?: string[];
  /** fixtures that will be left out soon (a close-up being prepared): their departments are re-merged
   * without them in idle time, so the switch costs nothing when it comes */
  prepareHide?: string[];
  /** a close-up's blend (0 … 1): the rest of the store dims into a backdrop (darker, no glow, no outlines) */
  dimRef?: { current: number };
}

interface Built {
  f: StoreGraph["fixtures"] extends (infer T)[] | undefined ? T : never;
  p: FixtureParams;
  hull: Box;
  parts: Parts;
}

export function Fixtures({ store, textureUrl, repeatMeters = 2, nodes, fromEntrance, hide, prepareHide, dimRef }: FixturesProps) {
  const hideKey = (hide ?? []).join("|");
  const prepareKey = (prepareHide ?? []).join("|");
  const departments = useMemo(() => store.departments ?? [], [store]);
  const withTexture = useMemo(() => departments.filter((d) => d.texture && !d.finish), [departments]);
  const finishes = useMemo(() => [...new Set(departments.flatMap((d) => (d.finish ? [d.finish] : [])))], [departments]);
  const textures = useLoader(TextureLoader, [...withTexture.map((d) => textureUrl(d.texture!)), ...finishes.map((f) => textureUrl(FINISH_FILE[f]))]);
  const textureFor = useMemo(() => {
    const m = new Map<string, Texture>();
    const keys = [...withTexture.map((d) => d.id), ...finishes.map((f) => `finish:${f}`)];
    keys.forEach((key, i) => {
      const t = textures[i];
      t.wrapS = t.wrapT = RepeatWrapping;
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 4;
      m.set(key, t);
    });
    return m;
  }, [withTexture, finishes, textures]);

  const built = useMemo(() => builtFor(store, repeatMeters), [store, repeatMeters]);

  const materialFor = (dept: Department | undefined) => {
    const map = dept ? textureFor.get(dept.id) ?? null : null;
    return new MeshStandardMaterial({ map, color: dept ? (map ? tint(dept.color) : new Color(dept.color)) : new Color("#DCE3D4"), roughness: 0.85, metalness: 0 });
  };
  const finishMaterial = (finish: Finish) =>
    finish === "wood"
      ? new MeshStandardMaterial({ map: textureFor.get("finish:wood") ?? null, color: "#FFFFFF", roughness: 0.75, metalness: 0 })
      : // no environment map in this scene, so metalness would only darken the steel: stainless reads by its
        // brushed texture, a low roughness, neutral light and a little grey of its own so the shaded sides stay steel
        neutralLight(new MeshStandardMaterial({ map: textureFor.get("finish:stainless") ?? null, color: "#F4F5F3", emissive: new Color("#6B6E6C"), emissiveIntensity: 1, roughness: 0.3, metalness: 0 }));

  // Each department's merged geometry is cached by the store (module scope: prepared ahead on the list screen,
  // prepareFixtures); here it only gets its meshes and materials. Hiding a close-up's fixtures swaps in their
  // departments' other merge; every other department keeps its meshes.
  type Group = { key: string; opaque: Mesh | null; trim: Mesh | null; glass: Mesh | null; frame: Mesh | null; glow: Mesh | null };
  const cache = useRef(new Map<string, Group>());
  useEffect(() => () => cache.current.clear(), [built, departments, textureFor]);
  const groupsFor = (key: string) =>
    mergedFor(store, repeatMeters, key).map((m) => {
      let g = cache.current.get(m.id);
      if (!g) {
        const dept = m.finish ? undefined : departments.find((d) => d.id === m.key);
        g = {
          key: m.key,
          opaque: m.opaque ? new Mesh(m.opaque, m.finish ? finishMaterial(m.finish) : materialFor(dept)) : null,
          trim: m.trim ? new Mesh(m.trim, STEEL) : null,
          glass: m.glass ? new Mesh(m.glass, GLASS) : null,
          frame: m.frame ? new Mesh(m.frame, m.finish === "stainless" ? FRAME_STEEL : FRAME) : null,
          glow: m.glow ? new Mesh(m.glow, m.finish === "stainless" ? GLOW_STEEL : GLOW) : null,
        };
        cache.current.set(m.id, g);
      }
      return g;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupsFor(hideKey), [built, departments, textureFor, hideKey]);
  // prepared ahead in the trip (the next stop's close-up): the variant without the soon-hidden fixtures, in idle time
  useEffect(() => {
    if (!prepareKey || prepareKey === hideKey) return;
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const run = () => {
      groupsFor(prepareKey);
      edgesFor(prepareKey);
    };
    const id = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 2000 }) : window.setTimeout(run, 100);
    return () => (w.cancelIdleCallback ?? clearTimeout)(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepareKey, hideKey, built]);

  // Every hull outline in one line batch: one draw call for the whole store instead of one per department
  // (thirteen departments would otherwise spend thirteen of the seventy-call budget on outlines).
  const edgeCache = useRef(new Map<string, LineSegments | null>());
  const edgesFor = (key: string) => {
    if (edgeCache.current.has(key)) return edgeCache.current.get(key)!;
    const geo = edgesGeometryFor(store, repeatMeters, key);
    const e = geo ? new LineSegments(geo, EDGE_WHITE) : null;
    edgeCache.current.set(key, e);
    return e;
  };
  useEffect(() => () => edgeCache.current.clear(), [built]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const edges = useMemo(() => edgesFor(hideKey), [built, hideKey]);

  // Aisle signs: one plane per labelled fixture on its entrance-facing end, one atlas texture.
  const signs = useMemo(() => {
    // (the signs are never hidden: a close-up hides them with the outlines as it dims the store)
    const labelled = built.filter((b) => b.f.aisle);
    if (!labelled.length) return null;
    const labels = [...new Set(labelled.map((b) => b.f.aisle!))];
    const { texture, cells } = buildSignAtlas(labels);
    const planes = labelled.flatMap((b) => {
      const cell = cells.get(b.f.aisle!);
      if (!cell) return [];
      const front = frontOf(b.hull, nodes, fromEntrance);
      const w = Math.min(Math.max(front.width, 1.2), 3.2);
      const h = w / 4;
      const g = new PlaneGeometry(w, h);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, cell.u0 + uv.getX(i) * (cell.u1 - cell.u0), cell.v0 + uv.getY(i) * (cell.v1 - cell.v0));
      g.rotateY(Math.atan2(front.nx, front.nz));
      g.translate(front.x + front.nx * 0.05, Math.min(b.hull.h - h / 2 - 0.1, 1.35), front.z + front.nz * 0.05);
      return [g];
    });
    const geo = merge(planes)!;
    const mat = new MeshStandardMaterial({ map: texture, transparent: true, side: DoubleSide, roughness: 1, depthWrite: false });
    return new Mesh(geo, mat);
  }, [built, nodes, fromEntrance]);

  // dimming in place, as the close-up's camera comes down: the merged meshes stay, their materials darken
  // (restored on the way out)
  const lastDim = useRef(-1);
  const applyDim = (k: number) => {
    for (const g of groups)
      for (const m of [g.opaque, g.trim, g.frame, g.glow]) {
        const mat = m?.material as MeshStandardMaterial | undefined;
        if (!mat) continue;
        const base = (mat.userData.base ??= { color: mat.color.clone(), emissive: mat.emissiveIntensity });
        mat.color.copy(base.color).multiplyScalar(1 - 0.6 * k);
        mat.emissiveIntensity = base.emissive * (1 - k);
      }
    if (edges) edges.visible = k < 0.5;
    if (signs) signs.visible = k < 0.5;
  };
  useFrame(() => {
    const k = dimRef?.current ?? 0;
    if (Math.abs(k - lastDim.current) < 0.01) return;
    lastDim.current = k;
    applyDim(k);
  });
  useEffect(() => {
    lastDim.current = -1; // a new variant's meshes take the current dim on the next frame
    return () => applyDim(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  return (
    <group name="fixtures">
      {groups.map((g) => (
        <group key={g.key}>
          {g.opaque && <primitive object={g.opaque} />}
          {g.trim && <primitive object={g.trim} />}
          {g.glow && <primitive object={g.glow} />}
          {g.frame && <primitive object={g.frame} />}
          {g.glass && <primitive object={g.glass} />}
        </group>
      ))}
      {edges && <primitive object={edges} />}
      {signs && <primitive object={signs} />}
    </group>
  );
}
