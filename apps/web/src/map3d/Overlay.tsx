// Screen-space markers and labels. The DOM lives outside the Canvas
// (OverlayDom); a small component inside the Canvas (OverlayProjector)
// projects each marker every rendered frame and writes its transform.
// One React tree, no per-marker roots, nothing scales with zoom.

import { useEffect, useMemo, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { collapseColliding, mayShowCard, type Box, type CardCandidate } from "./cardPlan.ts";
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

/** An unvisited stop after the next one, at its shelf slot: a card for the two after next, else its numbered dot. */
export interface StopCard {
  key: string;
  pos: [number, number, number];
  name: string;
  color?: string;
  n: number;
}


export interface OverlayProps {
  nodes: Map<string, GraphNode>;
  positionNodeId: string;
  nextNodeId?: string | null;
  /** exact next-stop point (the lit slot on the shelf face); falls back to the node at shelf height */
  nextPos?: [number, number, number] | null;
  nextLabel?: NextLabel | null;
  doneNodeIds: string[];
  /** the unvisited stops after the next one, in route order, at their slots (cardPlan.ts decides card or dot) */
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
  /** takes part in the card collision pass: "next" and "checkout" are placed first, "stop" cards may collapse */
  card?: "next" | "checkout" | "stop";
}

/** px between a stop's point and the bottom of its card */
const CARD_LIFT = 6;

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
    (p.cards ?? []).forEach((c, i) => {
      const dot = <span className="m-ahead">{c.n}</span>;
      if (!mayShowCard(i)) {
        out.push({ key: `stop-${c.key}`, pos: c.pos, className: "m-stop", node: dot });
        return;
      }
      out.push({
        key: `stop-${c.key}`,
        pos: c.pos,
        className: "m-stop m-stop--card",
        card: "stop",
        node: (
          <>
            {dot}
            <span className="m-card">
              <i className="dot" style={c.color ? { background: c.color } : undefined} />
              <span className="name">{c.name}</span>
              <b className="n">{c.n}</b>
            </span>
          </>
        ),
      });
    });
    const lane = at(p.laneNodeId, 0.1);
    if (lane) {
      out.push({ key: "lane", pos: lane, node: <span className="m-lane" /> });
      if (p.checkoutLabel)
        out.push({
          key: "lane-label",
          pos: [lane[0], 0.1, lane[2] + 1.4],
          className: "m-anchor-top",
          clamp: "top",
          card: "checkout",
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
          card: "next",
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
  }, [p.nodes, p.positionNodeId, p.nextNodeId, p.nextPos, p.nextLabel, p.nextColor, p.doneNodeIds, p.donePositions, p.cards, p.laneNodeId, p.checkoutLabel, p.entranceId, p.exitId, h]);
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

/**
 * Inside the Canvas: projects every item each rendered frame. Labels are clamped into the map area. Then
 * the card pass (cardPlan.ts): the next-stop card and the checkout callout are placed, and each of the two
 * stop cards after them stays a card only if it fits the map area without touching anything placed;
 * otherwise it collapses to its numbered dot. The same at every distance and in the flattened view.
 */
export function OverlayProjector({ items, registry, safe }: { items: OverlayItem[]; registry: OverlayRegistry; safe?: { top: number; bottom: number } }) {
  const { camera, size, invalidate } = useThree();
  const v = useMemo(() => new Vector3(), []);
  // a stop card's size does not change while it exists: measure it once (collapsed cards keep their box)
  const cardSize = useMemo(() => new Map<string, { w: number; h: number; el: HTMLElement }>(), [items]);
  const PAD = 12;
  const project = () => {
    const top = (safe?.top ?? 0.16) * size.height + PAD;
    const bottom = size.height - (safe?.bottom ?? 0.36) * size.height - PAD;
    const area: Box = { x0: PAD, x1: size.width - PAD, y0: top, y1: bottom };
    const candidates: CardCandidate[] = [];
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
      const onScreen = v.z < 1;
      el.style.visibility = onScreen ? "visible" : "hidden";
      if (!it.card) continue;
      let box: Box | null = null;
      if (onScreen) {
        if (it.card === "stop") {
          let s = cardSize.get(it.key);
          if (!s) {
            const c = el.querySelector<HTMLElement>(".m-card");
            if (c && c.offsetWidth) cardSize.set(it.key, (s = { w: c.offsetWidth, h: c.offsetHeight, el: c }));
          }
          if (s) {
            // a stop inside the map area keeps its card inside it too: the card slides sideways off the
            // edge, still above its point; a stop outside the area keeps its card unmoved, so it collapses
            const inX = x >= area.x0 && x <= area.x1;
            const cx = inX ? Math.max(area.x0 + s.w / 2, Math.min(area.x1 - s.w / 2, x)) : x;
            s.el.style.setProperty("--dx", `${(cx - x).toFixed(1)}px`);
            box = { x0: cx - s.w / 2, x1: cx + s.w / 2, y0: y - CARD_LIFT - s.h, y1: y - CARD_LIFT };
          }
        } else {
          const w = el.offsetWidth || 160;
          const h = el.offsetHeight || 48;
          box = it.card === "next" ? { x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y } : { x0: x - w / 2, x1: x + w / 2, y0: y, y1: y + h };
        }
      }
      candidates.push({ key: it.key, box, fixed: it.card !== "stop" });
    }
    const collapsed = collapseColliding(candidates, area);
    for (const c of candidates) {
      if (c.fixed) continue;
      registry.get(c.key)?.classList.toggle("m-collapsed", collapsed.has(c.key));
    }
  };
  useFrame(project);
  useEffect(() => {
    invalidate();
  }, [items, invalidate]);
  return null;
}
