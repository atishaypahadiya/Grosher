// The route ribbon on the floor: walked (white 40%), current leg (white with
// a wide soft copy the bloom picks up), ahead (white 85%, dashed).

import { Line } from "@react-three/drei";
import type { GraphNode } from "@grosher/core";

export interface RibbonProps {
  nodes: Map<string, GraphNode>;
  walked: string[];
  current: string[];
  ahead: string[];
}

const Y = 0.03;

function toPoints(ids: string[], nodes: Map<string, GraphNode>): [number, number, number][] {
  const pts: [number, number, number][] = [];
  let last: string | undefined;
  for (const id of ids) {
    if (id === last) continue;
    const n = nodes.get(id);
    if (n) pts.push([n.x, Y, n.y]);
    last = id;
  }
  return pts;
}

export function Ribbon({ nodes, walked, current, ahead }: RibbonProps) {
  const w = toPoints(walked, nodes);
  const c = toPoints(current, nodes);
  const a = toPoints(ahead, nodes);
  return (
    <group name="ribbon">
      {w.length > 1 && <Line points={w} color="#FFFFFF" transparent opacity={0.4} lineWidth={2} depthTest={false} />}
      {c.length > 1 && (
        <>
          <Line points={c} color="#FFFFFF" transparent opacity={0.35} lineWidth={5} depthTest={false} />
          <Line points={c} color="#FFFFFF" lineWidth={2} depthTest={false} toneMapped={false} />
        </>
      )}
      {a.length > 1 && <Line points={a} color="#FFFFFF" transparent opacity={0.85} lineWidth={2} dashed dashSize={0.35} gapSize={1.2} depthTest={false} />}
    </group>
  );
}
