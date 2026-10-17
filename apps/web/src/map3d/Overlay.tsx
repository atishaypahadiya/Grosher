// Screen-space markers and labels. The DOM lives outside the Canvas
// (OverlayDom); a small component inside the Canvas (OverlayProjector)
// projects each marker every rendered frame and writes its transform.
// One React tree, no per-marker roots, nothing scales with zoom.

import { useEffect, useMemo, type ReactNode } from "react";
import { cameraStats } from "./CameraRig.tsx";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import type { GraphNode } from "@grosher/core";
import { IconArrowRight, IconCheck } from "../components/Icons.tsx";

export interface NextLabel {
  eyebrow: string;
  name: string;
  distance: string;
  /** "Left · bay 4 · shelf 3" */
  slot?: string;
}

/** An unvisited stop's card at its shelf slot. */
export interface StopCard {
  key: string;
  pos: [number, number, number];
  name: string;
  color?: string;
  n: number;
}

/** Cards and the next-stop card hide beyond this camera distance; the numbered dots take over. */
export const CARDS_MAX_M = 40;

export interface OverlayProps {
  nodes: Map<string, GraphNode>;
  positionNodeId: string;
  nextNodeId?: string | null;
  /** exact next-stop point (the lit slot on the shelf face); falls back to the node at shelf height */
  nextPos?: [number, number, number] | null;
  nextLabel?: NextLabel | null;
  aheadNodeIds: string[];
  doneNodeIds: string[];
  /** cards for the unvisited stops after the next one, at their slots */
  cards?: StopCard[];
  /** done stops at their slots (falls back to doneNodeIds at shelf height) */
  donePositions?: [number, number, number][];
  /** department colour of the next stop, for its card's dot */
  nextColor?: string;
  laneNodeId?: string | null;
  checkoutLabel?: { eyebrow: string; line: string } | null;
  entranceId: string;
  exitId: string;
  shelfHeight?: number;
}

export interface OverlayItem {
  key: string;
  pos: [number, number, number];
  node: ReactNode;
  className?: string;
  /** keep this item inside the padded map area (labels), never under the strip or the sheet */
  clamp?: "bottom" | "top";
}

/** Element registry shared between the DOM tree and the projector. */
export type OverlayRegistry = Map<string, HTMLDivElement>;

export function useOverlayItems(p: OverlayProps): OverlayItem[] {
  const h = p.shelfHeight ?? 1.2;
  return useMemo<OverlayItem[]>(() => {
    const at = (id: string | null | undefined, y: number): [number, number, number] | null => {
      const n = id ? p.nodes.get(id) : undefined;
      return n ? [n.x, y, n.y] : null;
    };
    const out: OverlayItem[] = [];
    const entrance = at(p.entranceId, 0.1);
    const exit = at(p.exitId, 0.1);
    if (entrance) out.push({ key: "entrance", pos: entrance, node: <span className="m-ring m-entrance"><IconArrowRight /></span> });
    if (exit) out.push({ key: "exit", pos: exit, node: <span className="m-ring m-exit" /> });
    if (p.donePositions) {
      p.donePositions.forEach((pos, i) => out.push({ key: `done-${i}`, pos, node: <span className="m-done"><IconCheck /></span> }));
    } else {
      p.doneNodeIds.forEach((id, i) => {
        const pos = at(id, h);
        if (pos) out.push({ key: `done-${i}`, pos, node: <span className="m-done"><IconCheck /></span> });
      });
    }
    p.aheadNodeIds.forEach((id, i) => {
      const pos = at(id, h);
      if (pos) out.push({ key: `ahead-${id}-${i}`, pos, node: <span className="m-ahead m-far-only">{i + 2}</span> });
    });
    for (const c of p.cards ?? []) {
      out.push({
        key: `card-${c.key}`,
        pos: c.pos,
        className: "m-anchor-bottom m-near-only",
        clamp: "bottom",
        node: (
          <span className="m-card">
            <i className="dot" style={c.color ? { background: c.color } : undefined} />
            <span className="name">{c.name}</span>
            <b className="n">{c.n}</b>
          </span>
        ),
      });
    }
    const lane = at(p.laneNodeId, 0.1);
    if (lane) {
      out.push({ key: "lane", pos: lane, node: <span className="m-lane" /> });
      if (p.checkoutLabel)
        out.push({
          key: "lane-label",
          pos: [lane[0], 0.1, lane[2] + 1.4],
          className: "m-anchor-top",
          clamp: "top",
          node: (
            <div className="m-label m-label-checkout">
              <span className="eyebrow now">{p.checkoutLabel.eyebrow}</span>
              <span className="m-label-line">{p.checkoutLabel.line}</span>
            </div>
          ),
        });
    }
    const next = p.nextPos ?? at(p.nextNodeId, h);
    if (next) {
      out.push({ key: "next", pos: next, node: <span className="m-next"><i className="m-leader" /></span> });
      if (p.nextLabel)
        out.push({
          key: "next-label",
          pos: [next[0], next[1] + 2.6, next[2]],
          className: "m-anchor-bottom",
          clamp: "bottom",
          node: (
            <div className="m-label m-label-next m-card m-card--next">
              <span className="eyebrow now">
                <i className="dot" style={p.nextColor ? { background: p.nextColor } : undefined} />
                {p.nextLabel.eyebrow}
              </span>
              <span className="m-label-name">{p.nextLabel.name}</span>
              <span className="m-label-line">{p.nextLabel.distance}</span>
              {p.nextLabel.slot && <span className="m-label-line m-label-slot">{p.nextLabel.slot}</span>}
            </div>
          ),
        });
    }
    const you = at(p.positionNodeId, 0.1);
    if (you) out.push({ key: "you", pos: you, node: <span className="m-you"><i className="m-halo" /></span> });
    return out;
  }, [p.nodes, p.positionNodeId, p.nextNodeId, p.nextPos, p.nextLabel, p.nextColor, p.aheadNodeIds, p.doneNodeIds, p.donePositions, p.cards, p.laneNodeId, p.checkoutLabel, p.entranceId, p.exitId, h]);
}

/** Plain DOM, rendered by TripMap3D next to the Canvas. */
export function OverlayDom({ items, registry }: { items: OverlayItem[]; registry: OverlayRegistry }) {
  return (
    <div
      className="m-overlay"
      aria-hidden
      ref={(el) => {
        if (el) registry.set("__root", el);
        else registry.delete("__root");
      }}
    >
      {items.map((it) => (
        <div
          key={it.key}
          className={["m-item", it.className].filter(Boolean).join(" ")}
          ref={(el) => {
            if (el) registry.set(it.key, el);
            else registry.delete(it.key);
          }}
        >
          {it.node}
        </div>
      ))}
    </div>
  );
}

/** Inside the Canvas: projects every item each rendered frame. Labels are clamped into the map area. */
export function OverlayProjector({ items, registry, safe }: { items: OverlayItem[]; registry: OverlayRegistry; safe?: { top: number; bottom: number } }) {
  const { camera, size, invalidate } = useThree();
  const v = useMemo(() => new Vector3(), []);
  const PAD = 12;
  const project = () => {
    const root = registry.get("__root");
    if (root) root.classList.toggle("m-overlay--far", cameraStats.distance > CARDS_MAX_M);
    const top = (safe?.top ?? 0.16) * size.height + PAD;
    const bottom = size.height - (safe?.bottom ?? 0.36) * size.height - PAD;
    for (const it of items) {
      const el = registry.get(it.key);
      if (!el) continue;
      v.set(it.pos[0], it.pos[1], it.pos[2]).project(camera);
      let x = ((v.x + 1) / 2) * size.width;
      let y = ((1 - v.y) / 2) * size.height;
      if (it.clamp) {
        const w = el.offsetWidth || 160;
        const h = el.offsetHeight || 48;
        x = Math.max(PAD + w / 2, Math.min(size.width - PAD - w / 2, x));
        y = it.clamp === "bottom" ? Math.max(top + h, Math.min(bottom, y)) : Math.max(top, Math.min(bottom - h, y));
      }
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.visibility = v.z < 1 ? "visible" : "hidden";
    }
  };
  useFrame(project);
  useEffect(() => {
    invalidate();
  }, [items, invalidate]);
  return null;
}
