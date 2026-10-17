// The lit slot: the exact bay × shelf × face of the next stop, as a
// translucent lime volume (products show through) with a 2 px rim. It
// ignores depth so it reads through shelving from any angle, and the
// selective bloom pass sees this mesh.

import { useEffect, useMemo } from "react";
import { BoxGeometry, Color, EdgesGeometry, Mesh, MeshStandardMaterial } from "three";
import { Line } from "@react-three/drei";
import { shelfHeight, type Slot } from "@grosher/stores";

const LIME = new Color("#D4FF4A");

/** read by Perf.tsx */
export const litStats: { slot: null | { fixture: string; bay: number; shelf: number; face: string; cx: number; cy: number; cz: number; w: number; h: number; d: number } } = { slot: null };

export function slotVolume(slot: Slot): { cx: number; cy: number; cz: number; w: number; h: number; d: number } {
  const { params: p, rect, shelf } = slot;
  const y0 = slot.heightM;
  const y1 = shelf + 1 < p.shelves ? shelfHeight(p, shelf + 1) : Math.max(y0 + 0.3, p.height);
  const h = Math.max(0.2, y1 - y0 - 0.03);
  return { cx: rect.x + rect.w / 2, cy: y0 + h / 2, cz: rect.y + rect.h / 2, w: rect.w, h, d: rect.h };
}

export function LitSlot({ slot, onMesh }: { slot: Slot; onMesh?: (m: Mesh | null) => void }) {
  const built = useMemo(() => {
    const v = slotVolume(slot);
    const geo = new BoxGeometry(v.w, v.h, v.d);
    geo.translate(v.cx, v.cy, v.cz);
    const mat = new MeshStandardMaterial({ color: LIME, emissive: LIME, emissiveIntensity: 0.45, transparent: true, opacity: 0.42, depthWrite: false, depthTest: false, roughness: 0.6 });
    const pos = new EdgesGeometry(geo).attributes.position;
    const rim: [number, number, number][] = [];
    for (let i = 0; i < pos.count; i++) rim.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = 10;
    return { mesh, rim };
  }, [slot]);
  useEffect(() => {
    onMesh?.(built.mesh);
    const v = slotVolume(slot);
    litStats.slot = { fixture: slot.fixture.id, bay: slot.bay, shelf: slot.shelf, face: slot.face, ...v };
    return () => {
      onMesh?.(null);
      litStats.slot = null;
    };
  }, [built, onMesh, slot]);
  return (
    <group name="lit-slot">
      <primitive object={built.mesh} />
      <Line segments points={built.rim} color="#D4FF4A" lineWidth={2} toneMapped={false} depthTest={false} renderOrder={11} />
    </group>
  );
}
