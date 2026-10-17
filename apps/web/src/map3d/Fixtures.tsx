// Fixtures: detailed geometry per department fixture kind (gondola, cold
// case, produce table, bakery table, counter), merged per department into
// one opaque mesh (department texture on the visible faces), one glass
// mesh, one frame mesh and one glow mesh where the kind needs them, plus
// one hull outline per department and one atlas mesh for the aisle signs.
// The next stop's slot is lit separately (LitSlot).

import { useMemo } from "react";
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

export interface FixturesProps {
  store: StoreGraph;
  textureUrl: (file: string) => string;
  repeatMeters?: number;
  nodes: Map<string, GraphNode>;
  fromEntrance: Map<string, number>;
}

interface Built {
  f: StoreGraph["fixtures"] extends (infer T)[] | undefined ? T : never;
  p: FixtureParams;
  hull: Box;
  parts: Parts;
}

export function Fixtures({ store, textureUrl, repeatMeters = 2, nodes, fromEntrance }: FixturesProps) {
  const departments = useMemo(() => store.departments ?? [], [store]);
  const withTexture = useMemo(() => departments.filter((d) => d.texture), [departments]);
  const textures = useLoader(TextureLoader, withTexture.map((d) => textureUrl(d.texture!)));
  const textureFor = useMemo(() => {
    const m = new Map<string, Texture>();
    withTexture.forEach((d, i) => {
      const t = textures[i];
      t.wrapS = t.wrapT = RepeatWrapping;
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 4;
      m.set(d.id, t);
    });
    return m;
  }, [withTexture, textures]);

  // Every fixture's detailed parts, once per store.
  const built = useMemo<Built[]>(() => {
    const centre = { x: 0, y: 0 };
    const all = store.fixtures ?? [];
    if (all.length) {
      centre.x = all.reduce((s, f) => s + fixtureBox(f).cx, 0) / all.length;
      centre.y = all.reduce((s, f) => s + fixtureBox(f).cz, 0) / all.length;
    }
    return all.map((f) => {
      const p = fixtureParams(f, departments);
      const hull = fixtureBox(f);
      // a wall run opens toward the store centre: local +z is map +z for horizontal runs, map −x for vertical (rotateY(−π/2) maps local z → map −x)
      const towardCentre: 1 | -1 = p.vertical ? (centre.x < p.cx ? 1 : -1) : centre.y > p.cz ? 1 : -1;
      const parts = generate(p, repeatMeters, { wall: f.kind === "wall", towardCentre, frontSign: frontSignOf(p, store) });
      return { f, p, hull, parts };
    });
  }, [store, departments, repeatMeters]);

  const materialFor = (dept: Department | undefined) => {
    const map = dept ? textureFor.get(dept.id) ?? null : null;
    return new MeshStandardMaterial({ map, color: dept ? (map ? tint(dept.color) : new Color(dept.color)) : new Color("#DCE3D4"), roughness: 0.85, metalness: 0 });
  };

  // Merged per department.
  const groups = useMemo(() => {
    const byDept = new Map<string, Built[]>();
    for (const b of built) {
      const key = b.f.department ?? "_none";
      byDept.set(key, [...(byDept.get(key) ?? []), b]);
    }
    const out: { key: string; opaque: Mesh | null; glass: Mesh | null; frame: Mesh | null; glow: Mesh | null; edges: LineSegments | null }[] = [];
    for (const [key, list] of byDept) {
      const dept = departments.find((d) => d.id === key);
      const parts = emptyParts();
      for (const b of list) {
        parts.opaque.push(...b.parts.opaque);
        parts.glass.push(...b.parts.glass);
        parts.frame.push(...b.parts.frame);
        parts.glow.push(...b.parts.glow);
      }
      const opaque = merge(parts.opaque);
      const glass = merge(parts.glass);
      const frame = merge(parts.frame);
      const glow = merge(parts.glow);
      const hulls = merge(list.map((b) => hullGeometry(b.hull)));
      out.push({
        key,
        opaque: opaque ? new Mesh(opaque, materialFor(dept)) : null,
        glass: glass ? new Mesh(glass, GLASS) : null,
        frame: frame ? new Mesh(frame, FRAME) : null,
        glow: glow ? new Mesh(glow, GLOW) : null,
        edges: hulls ? new LineSegments(new EdgesGeometry(hulls), EDGE_WHITE) : null,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, departments, textureFor]);

  // Aisle signs: one plane per labelled fixture on its entrance-facing end, one atlas texture.
  const signs = useMemo(() => {
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

  return (
    <group name="fixtures">
      {groups.map((g) => (
        <group key={g.key}>
          {g.opaque && <primitive object={g.opaque} />}
          {g.glow && <primitive object={g.glow} />}
          {g.frame && <primitive object={g.frame} />}
          {g.glass && <primitive object={g.glass} />}
          {g.edges && <primitive object={g.edges} />}
        </group>
      ))}
      {signs && <primitive object={signs} />}
    </group>
  );
}
