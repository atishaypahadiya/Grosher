// Fixtures: one merged mesh per department (texture tiled on top and side
// faces), one merged edge-line set per department, one atlas mesh for the
// aisle signs, and the lit fixture (next stop) drawn on its own with lime.

import { useMemo } from "react";
import { BoxGeometry, Color, DoubleSide, EdgesGeometry, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useLoader } from "@react-three/fiber";
import type { Department, GraphNode, StoreGraph } from "@grosher/core";
import { type Box, fixtureBox, frontOf } from "./layout.ts";
import { buildSignAtlas } from "./signs.ts";

const LIME = new Color("#D4FF4A");
const EDGE_WHITE = new LineBasicMaterial({ color: "#FFFFFF", transparent: true, opacity: 0.35 });
const EDGE_LIME = new LineBasicMaterial({ color: LIME, transparent: true, opacity: 1 });

/** A box with UVs scaled so the texture repeats every `repeat` metres on every face. */
function boxGeometry(b: Box, repeat: number) {
  const g = new BoxGeometry(b.w, b.h, b.d);
  const uv = g.attributes.uv;
  // face order: px, nx, py, ny, pz, nz; 4 vertices each
  const dims: [number, number][] = [
    [b.d, b.h],
    [b.d, b.h],
    [b.w, b.d],
    [b.w, b.d],
    [b.w, b.h],
    [b.w, b.h],
  ];
  for (let f = 0; f < 6; f++) {
    const [du, dv] = dims[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * du) / repeat, (uv.getY(i) * dv) / repeat);
    }
  }
  g.translate(b.cx, b.h / 2, b.cz);
  return g;
}

function tint(hex: string) {
  // department hex at 70% over white, so the photo's own grade shows through
  return new Color("#FFFFFF").lerp(new Color(hex), 0.7);
}

export interface FixturesProps {
  store: StoreGraph;
  textureUrl: (file: string) => string;
  repeatMeters?: number;
  litFixtureId?: string | null;
  nodes: Map<string, GraphNode>;
  fromEntrance: Map<string, number>;
}

export function Fixtures({ store, textureUrl, repeatMeters = 2, litFixtureId, nodes, fromEntrance }: FixturesProps) {
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

  const boxes = useMemo(() => (store.fixtures ?? []).map(fixtureBox), [store]);

  // Merged geometry per department, lit fixture excluded.
  const groups = useMemo(() => {
    const byDept = new Map<string, Box[]>();
    for (const b of boxes) {
      if (b.id === litFixtureId) continue;
      const key = b.department ?? "_none";
      byDept.set(key, [...(byDept.get(key) ?? []), b]);
    }
    const out: { dept: Department | undefined; key: string; mesh: Mesh; edges: LineSegments }[] = [];
    for (const [key, list] of byDept) {
      const geo = mergeGeometries(list.map((b) => boxGeometry(b, repeatMeters)), false)!;
      const dept = departments.find((d) => d.id === key);
      const map = dept ? textureFor.get(dept.id) ?? null : null;
      const mat = new MeshStandardMaterial({
        map,
        color: dept ? (map ? tint(dept.color) : new Color(dept.color)) : new Color("#DCE3D4"),
        roughness: 0.85,
        metalness: 0,
      });
      out.push({ dept, key, mesh: new Mesh(geo, mat), edges: new LineSegments(new EdgesGeometry(geo), EDGE_WHITE) });
    }
    return out;
  }, [boxes, litFixtureId, repeatMeters, departments, textureFor]);

  const lit = useMemo(() => {
    const b = boxes.find((x) => x.id === litFixtureId);
    if (!b) return null;
    const geo = boxGeometry(b, repeatMeters);
    const dept = departments.find((d) => d.id === b.department);
    const map = dept ? textureFor.get(dept.id) ?? null : null;
    const mat = new MeshStandardMaterial({
      map,
      color: dept ? (map ? tint(dept.color).lerp(new Color("#FFFFFF"), 0.25) : new Color(dept.color)) : new Color("#DCE3D4"),
      emissive: LIME,
      emissiveIntensity: 0.25,
      roughness: 0.8,
    });
    return { mesh: new Mesh(geo, mat), edges: new LineSegments(new EdgesGeometry(geo), EDGE_LIME) };
  }, [boxes, litFixtureId, repeatMeters, departments, textureFor]);

  // Aisle signs: one plane per labelled fixture on its entrance-facing end, one atlas texture.
  const signs = useMemo(() => {
    const labelled = boxes.filter((b) => b.aisle);
    if (!labelled.length) return null;
    const labels = [...new Set(labelled.map((b) => b.aisle!))];
    const { texture, cells } = buildSignAtlas(labels);
    const planes = labelled.flatMap((b) => {
      const cell = cells.get(b.aisle!);
      if (!cell) return [];
      const front = frontOf(b, nodes, fromEntrance);
      const w = Math.min(Math.max(front.width, 1.2), 3.2);
      const h = w / 4;
      const g = new PlaneGeometry(w, h);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, cell.u0 + uv.getX(i) * (cell.u1 - cell.u0), cell.v0 + uv.getY(i) * (cell.v1 - cell.v0));
      const yaw = Math.atan2(front.nx, front.nz); // plane normal is +z by default
      g.rotateY(yaw);
      g.translate(front.x + front.nx * 0.03, Math.min(b.h - h / 2 - 0.1, 1.35), front.z + front.nz * 0.03);
      return [g];
    });
    const geo = mergeGeometries(planes, false)!;
    const mat = new MeshStandardMaterial({ map: texture, transparent: true, side: DoubleSide, roughness: 1, depthWrite: false });
    return new Mesh(geo, mat);
  }, [boxes, nodes, fromEntrance]);

  return (
    <group name="fixtures">
      {groups.map((g) => (
        <group key={g.key}>
          <primitive object={g.mesh} />
          <primitive object={g.edges} />
        </group>
      ))}
      {lit && (
        <group name="lit">
          <primitive object={lit.mesh} />
          <primitive object={lit.edges} />
        </group>
      )}
      {signs && <primitive object={signs} />}
    </group>
  );
}
