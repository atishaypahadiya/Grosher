// Screen-space markers and labels. The DOM lives outside the Canvas
// (OverlayDom); a small component inside the Canvas (OverlayProjector)
// projects each marker every rendered frame and writes its transform.
// One React tree, no per-marker roots, nothing scales with zoom.

import { useEffect, useMemo, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { mayShowCard, planCards, type Box, type FixedLabel, type Size, type StopInput } from "./cardPlan.ts";
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
  /** walking distance from you along the route, for the edge chip ("64 m") */
  distance?: string;
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
  /** takes part in the card pass: "next" and "checkout" are placed first, "stop" cards are planned around
   * them, and a "marker" (the next stop's lime dot and leader line) is kept clear */
  card?: "next" | "checkout" | "stop" | "marker";
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
        // each part is placed in screen space by the projector (cardPlan.ts decides which one shows)
        node: (
          <>
            {dot}
            <i className="m-leader-line" />
            <span className="m-card">
              <i className="dot" style={c.color ? { background: c.color } : undefined} />
              <span className="name">{c.name}</span>
              <b className="n">{c.n}</b>
            </span>
            <span className="m-card m-chip">
              <b className="n">{c.n}</b>
              <span className="name">{c.name}</span>
              {c.distance && <span className="dist">{c.distance}</span>}
              <IconArrowRight className="arrow" />
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
      out.push({ key: "next", pos: next, card: "marker", node: <span className="m-next"><i className="m-leader" /></span> });
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
 * stops after them becomes a card above its point, a card stacked under the label it hit (with a leader to
 * its dot), an edge chip pointing at it when it is off the map, or its numbered dot. The same at every
 * distance and in the flattened view.
 */
export function OverlayProjector({ items, registry, safe }: { items: OverlayItem[]; registry: OverlayRegistry; safe?: { top: number; bottom: number } }) {
  const { camera, size, invalidate } = useThree();
  const v = useMemo(() => new Vector3(), []);
  // a stop's card and chip do not change size while the items stand: measure them once
  const parts = useMemo(() => new Map<string, { dot: HTMLElement; card: HTMLElement; chip: HTMLElement; leader: HTMLElement; cardSize: Size; chipSize: Size }>(), [items]);
  const PAD = 12;
  const project = () => {
    const top = (safe?.top ?? 0.16) * size.height + PAD;
    const bottom = size.height - (safe?.bottom ?? 0.36) * size.height - PAD;
    const area: Box = { x0: PAD, x1: size.width - PAD, y0: top, y1: bottom };
    const fixed: FixedLabel[] = [];
    const stops: StopInput[] = [];
    const obstacles: Box[] = [];
    for (const it of items) {
      const el = registry.get(it.key);
      if (!el) continue;
      v.set(it.pos[0], it.pos[1], it.pos[2]).project(camera);
      let x = ((v.x + 1) / 2) * size.width;
      let y = ((1 - v.y) / 2) * size.height;
      const onScreen = v.z < 1;
      if (it.card === "stop") {
        let p = parts.get(it.key);
        if (!p) {
          const q = (sel: string) => el.querySelector<HTMLElement>(sel)!;
          const card = q(".m-card:not(.m-chip)");
          const chip = q(".m-chip");
          if (!card?.offsetWidth || !chip?.offsetWidth) continue;
          p = { dot: q(".m-ahead"), card, chip, leader: q(".m-leader-line"), cardSize: { w: card.offsetWidth, h: card.offsetHeight }, chipSize: { w: chip.offsetWidth, h: chip.offsetHeight } };
          parts.set(it.key, p);
        }
        // the item sits at the screen origin; its parts are placed in screen pixels below
        el.style.transform = "translate(0px, 0px)";
        el.style.visibility = "visible";
        p.dot.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
        p.dot.style.visibility = onScreen ? "" : "hidden"; // behind the camera the projection is mirrored
        stops.push({ key: it.key, point: { x, y }, behind: !onScreen, card: p.cardSize, chip: p.chipSize });
        continue;
      }
      if (it.clamp) {
        const w = el.offsetWidth || 160;
        const h = el.offsetHeight || 48;
        x = Math.max(PAD + w / 2, Math.min(size.width - PAD - w / 2, x));
        y = it.clamp === "bottom" ? Math.max(top + h, Math.min(bottom, y)) : Math.max(top, Math.min(bottom - h, y));
      }
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.visibility = onScreen ? "visible" : "hidden";
      if (!it.card) continue;
      if (it.card === "marker") {
        // the 8 px lime dot and the 46 px leader above it (styles.css .m-next, .m-leader)
        if (onScreen) obstacles.push({ x0: x - 5, x1: x + 5, y0: y - 58, y1: y + 5 });
        continue;
      }
      const w = el.offsetWidth || 160;
      const h = el.offsetHeight || 48;
      const box = !onScreen ? null : it.card === "next" ? { x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y } : { x0: x - w / 2, x1: x + w / 2, y0: y, y1: y + h };
      fixed.push({ key: it.key, box });
    }
    for (const pl of planCards({ area, fixed, stops, obstacles, lift: CARD_LIFT })) {
      const el = registry.get(pl.key);
      const p = parts.get(pl.key);
      if (!el || !p) continue;
      el.dataset.mode = pl.mode;
      if (pl.mode === "card" || pl.mode === "stacked" || pl.mode === "chip") {
        const target = pl.mode === "chip" ? p.chip : p.card;
        target.style.transform = `translate(${pl.box.x0.toFixed(1)}px, ${pl.box.y0.toFixed(1)}px)`;
      }
      if (pl.mode === "chip") p.chip.style.setProperty("--angle", `${pl.angle.toFixed(3)}rad`);
      if (pl.mode === "stacked") {
        const { x0, y0, x1, y1 } = pl.leader;
        p.leader.style.width = `${Math.hypot(x1 - x0, y1 - y0).toFixed(1)}px`;
        p.leader.style.transform = `translate(${x0.toFixed(1)}px, ${y0.toFixed(1)}px) rotate(${Math.atan2(y1 - y0, x1 - x0).toFixed(3)}rad)`;
      }
    }
  };
  useFrame(project);
  useEffect(() => {
    invalidate();
  }, [items, invalidate]);
  return null;
}
