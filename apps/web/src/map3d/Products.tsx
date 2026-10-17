// Products on the shelves: one InstancedMesh per primitive (box, can,
// bottle, bag, tray). Each bay gets one product type; instances run along
// every shelf of every bay with seeded jitter in size and spacing, tinted
// by sampling the department texture. LOD: fixtures within 25 m of the
// settled camera get products; beyond that the texture alone carries the
// colour. The visible set is rebuilt on camera settle, never per frame.

import { useEffect, useMemo, useRef } from "react";
import { BoxGeometry, Color, CylinderGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader, Vector3, type BufferGeometry } from "three";
import { useLoader, useThree } from "@react-three/fiber";
import type { StoreGraph } from "@grosher/core";
import { DECK_M, fixtureParams, frontSignOf, shelfHeight, type FixtureParams } from "@grosher/stores";

export const LOD_M = 25;
export const MAX_VISIBLE = 12000;
const CAPACITY = 4000; // per primitive
const SHELF_T = 0.03;
const PRIMS = ["box", "can", "bottle", "bag", "tray"] as const;
type Prim = (typeof PRIMS)[number];

/** read by Perf.tsx */
export const productStats = { instances: 0, fixtures: 0 };

interface Item {
  prim: Prim;
  /** map-space position of the product centre */
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rotY: number;
  color: Color;
}

interface FixtureItems {
  id: string;
  cx: number;
  cz: number;
  w: number;
  d: number;
  items: Item[];
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

/** 48 colour samples from a texture image (or the flat department colour). */
function sampleColors(tex: Texture | undefined, fallback: string): Color[] {
  const out: Color[] = [];
  const img = tex?.image as HTMLImageElement | ImageBitmap | undefined;
  if (img && typeof document !== "undefined" && (img as HTMLImageElement).width) {
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.drawImage(img as CanvasImageSource, 0, 0, 16, 16);
      const data = ctx.getImageData(0, 0, 16, 16).data;
      const r = rng(11);
      for (let i = 0; i < 48; i++) {
        const k = Math.floor(r() * 256) * 4;
        out.push(new Color(data[k] / 255, data[k + 1] / 255, data[k + 2] / 255).convertSRGBToLinear());
      }
      return out;
    }
  }
  const base = new Color(fallback);
  for (let i = 0; i < 48; i++) out.push(base.clone().offsetHSL(0, 0, (i / 48 - 0.5) * 0.16));
  return out;
}

const SIZES: Record<Prim, (r: () => number) => [number, number, number]> = {
  box: (r) => [0.12 + r() * 0.12, 0.18 + r() * 0.14, 0.1 + r() * 0.1],
  can: (r) => [0.07 + r() * 0.03, 0.11 + r() * 0.04, 0.07 + r() * 0.03],
  bottle: (r) => [0.07 + r() * 0.03, 0.24 + r() * 0.08, 0.07 + r() * 0.03],
  bag: (r) => [0.14 + r() * 0.1, 0.2 + r() * 0.1, 0.06 + r() * 0.04],
  tray: (r) => [0.2 + r() * 0.1, 0.05 + r() * 0.03, 0.15 + r() * 0.08],
};

/** Which local faces are open: both for a free-standing run, one for a wall run. */
function openFaces(p: FixtureParams, wall: boolean, towardCentre: 1 | -1): (1 | -1)[] {
  return wall ? [towardCentre] : [1, -1];
}

/** Lay out every product of the store, grouped per fixture, in map space. */
export function layoutProducts(store: StoreGraph, colorsFor: (dept: string | undefined) => Color[]): FixtureItems[] {
  const all = store.fixtures ?? [];
  if (!all.length) return [];
  const centre = { x: 0, y: 0 };
  for (const f of all) {
    const p = fixtureParams(f, store.departments);
    centre.x += p.cx / all.length;
    centre.y += p.cz / all.length;
  }
  const out: FixtureItems[] = [];
  for (const f of all) {
    const p = fixtureParams(f, store.departments);
    if (p.kind === "counter") continue;
    const colors = colorsFor(f.department);
    const r = rng(hash(f.id));
    const wall = f.kind === "wall";
    const towardCentre: 1 | -1 = p.vertical ? (centre.x < p.cx ? 1 : -1) : centre.y > p.cz ? 1 : -1;
    const faces = openFaces(p, wall, towardCentre);
    const items: Item[] = [];
    const bayLen = p.length / p.bays;
    const levels = p.kind === "bakery" ? [p.height] : p.kind === "produce" ? [0.35, shelfHeight(p, 1) + 0.05, p.height].slice(0, p.shelves) : Array.from({ length: p.shelves }, (_, s) => shelfHeight(p, s) + SHELF_T);
    const depth = Math.min(p.depth, p.width / 2);
    const toMap = (lx: number, lz: number) => (p.vertical ? { x: p.cx - lz, z: p.cz + lx } : { x: p.cx + lx, z: p.cz + lz });
    const rotBase = p.vertical ? -Math.PI / 2 : 0;
    for (const face of faces) {
      for (let b = 0; b < p.bays; b++) {
        const prim: Prim = p.kind === "produce" ? "tray" : p.kind === "bakery" ? (r() < 0.5 ? "tray" : "bag") : PRIMS[Math.floor(r() * (PRIMS.length - 1))];
        const x0 = -p.length / 2 + b * bayLen + 0.06;
        const x1 = x0 + bayLen - 0.12;
        for (const y of levels) {
          const [bw, bh, bd] = SIZES[prim](r);
          let x = x0 + bw / 2 + r() * 0.04;
          const zFront = face * (p.width / 2 - bd / 2 - 0.04);
          const zBack = face * (p.width / 2 - depth + bd / 2 + 0.02);
          const rows = p.kind === "produce" || p.kind === "bakery" ? 2 : 1;
          while (x + bw / 2 <= x1) {
            for (let row = 0; row < rows; row++) {
              const z = row === 0 ? zFront : zBack;
              const sx = bw * (0.9 + r() * 0.2);
              const sy = bh * (0.9 + r() * 0.2);
              const sz = bd * (0.9 + r() * 0.2);
              const m = toMap(x, z);
              items.push({ prim, x: m.x, y: y + sy / 2, z: m.z, sx, sy, sz, rotY: rotBase + (r() - 0.5) * 0.12, color: colors[Math.floor(r() * colors.length)] });
            }
            x += bw + 0.02 + r() * 0.03;
          }
        }
      }
    }
    out.push({ id: f.id, cx: p.cx, cz: p.cz, w: p.w, d: p.d, items });
  }
  return out;
}

/** True distance from the camera to the nearest point of the fixture's footprint at shelf height. */
function distToFixture(fx: FixtureItems, x: number, y: number, z: number) {
  const dx = Math.max(Math.abs(x - fx.cx) - fx.w / 2, 0);
  const dz = Math.max(Math.abs(z - fx.cz) - fx.d / 2, 0);
  const dy = Math.max(y - 1.2, 0);
  return Math.hypot(dx, dy, dz);
}

export interface ProductsProps {
  store: StoreGraph;
  textureUrl: (file: string) => string;
  /** settled camera position, map metres (y up); null until the first settle */
  settled: { x: number; y: number; z: number } | null;
}

export function Products({ store, textureUrl, settled }: ProductsProps) {
  const invalidate = useThree((s) => s.invalidate);
  const departments = useMemo(() => store.departments ?? [], [store]);
  const withTexture = useMemo(() => departments.filter((d) => d.texture), [departments]);
  const textures = useLoader(TextureLoader, withTexture.map((d) => textureUrl(d.texture!)));
  const colorsFor = useMemo(() => {
    const cache = new Map<string, Color[]>();
    withTexture.forEach((d, i) => {
      const t = textures[i];
      t.wrapS = t.wrapT = RepeatWrapping;
      t.colorSpace = SRGBColorSpace;
    });
    return (dept: string | undefined) => {
      const key = dept ?? "_";
      let c = cache.get(key);
      if (!c) {
        const i = withTexture.findIndex((d) => d.id === dept);
        const d = departments.find((x) => x.id === dept);
        c = sampleColors(i >= 0 ? textures[i] : undefined, d?.color ?? "#DCE3D4");
        cache.set(key, c);
      }
      return c;
    };
  }, [withTexture, textures, departments]);

  const layout = useMemo(() => layoutProducts(store, colorsFor), [store, colorsFor]);

  const geometries = useMemo<Record<Prim, BufferGeometry>>(
    () => ({
      box: new BoxGeometry(1, 1, 1),
      can: new CylinderGeometry(0.5, 0.5, 1, 10),
      bottle: new CylinderGeometry(0.4, 0.5, 1, 8),
      bag: new BoxGeometry(1, 1, 1),
      tray: new BoxGeometry(1, 1, 1),
    }),
    [],
  );
  const material = useMemo(() => new MeshStandardMaterial({ roughness: 0.72, metalness: 0.02 }), []);
  const meshes = useRef<Record<Prim, InstancedMesh | null>>({ box: null, can: null, bottle: null, bag: null, tray: null });

  // Rebuild the visible set on camera settle.
  useEffect(() => {
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const pos = new Vector3();
    const counts: Record<Prim, number> = { box: 0, can: 0, bottle: 0, bag: 0, tray: 0 };
    let total = 0;
    let fixtures = 0;
    if (settled) {
      const d = (fx: FixtureItems) => distToFixture(fx, settled.x, settled.y, settled.z);
      const near = layout.filter((fx) => d(fx) <= LOD_M).sort((a, b) => d(a) - d(b));
      // keep whole fixtures while the budget allows; thin the last one by stride
      for (const fx of near) {
        const room = MAX_VISIBLE - total;
        if (room <= 0) break;
        const stride = fx.items.length > room ? Math.ceil(fx.items.length / room) : 1;
        fixtures++;
        for (let i = 0; i < fx.items.length; i += stride) {
          const it = fx.items[i];
          const mesh = meshes.current[it.prim];
          if (!mesh || counts[it.prim] >= CAPACITY) continue;
          q.setFromAxisAngle(new Vector3(0, 1, 0), it.rotY);
          s.set(it.sx, it.sy, it.sz);
          pos.set(it.x, it.y, it.z);
          m.compose(pos, q, s);
          mesh.setMatrixAt(counts[it.prim], m);
          mesh.setColorAt(counts[it.prim], it.color);
          counts[it.prim]++;
          total++;
          if (total >= MAX_VISIBLE) break;
        }
      }
    }
    for (const prim of PRIMS) {
      const mesh = meshes.current[prim];
      if (!mesh) continue;
      mesh.count = counts[prim];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    productStats.instances = total;
    productStats.fixtures = fixtures;
    invalidate();
  }, [layout, settled, invalidate]);

  return (
    <group name="products">
      {PRIMS.map((prim) => (
        <instancedMesh
          key={prim}
          ref={(mesh) => {
            meshes.current[prim] = mesh;
            if (mesh && !mesh.instanceColor) mesh.setColorAt(0, new Color("#ffffff"));
          }}
          args={[geometries[prim], material, CAPACITY]}
          count={0}
          frustumCulled
        />
      ))}
    </group>
  );
}
