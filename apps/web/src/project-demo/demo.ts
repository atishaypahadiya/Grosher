// The project page's "Try it" block (public/project/index.html): a typed list routed through Grosher with the
// app's own resolver (catalog only: the shipped rows, the shelf signs, and once loaded the full 47,000-item catalog;
// no model) and its own solver, drawn on a flat map of the store. Built by vite.demo.config.ts into
// dist/project/demo/demo.js; the page imports it on the first interaction with the block, so a visit that never
// touches it never downloads it.

import { Router, WalkGraph, resolveList, toStop, type ResolveResult, type Stop } from "@grosher/core";
import { departmentLocations, grosher } from "@grosher/stores";
import { buildCandidateIndex, type IndexResult } from "../lib/indexer.ts";

const APP = "https://grosher.pages.dev/";
const SVG = "http://www.w3.org/2000/svg";
const store = grosher.store;
const graph = new WalkGraph(store);
const router = new Router(graph);
const locations = new Set(store.locations.map((l) => l.id));
const deptLocs = departmentLocations(store);
const deptColor = new Map((store.departments ?? []).map((d) => [d.id, d.color]));

/** the full catalog's index: started at mount, used once it lands (the base rows and the signs answer before) */
let full: IndexResult | null = null;
const fullReady = grosher
  .loadCatalog()
  .then((catalog) => buildCandidateIndex(store.storeId, catalog, grosher.catalogKey))
  .then((r) => (full = r))
  .catch(() => null);

const parse = (text: string) => [...new Set(text.split(/[,;\n]/).map((s) => s.trim().slice(0, 60)).filter(Boolean))].slice(0, 30);

function resolve(items: string[]): ResolveResult[] {
  return resolveList(items, { catalog: grosher.catalog, index: full?.index, categories: grosher.categories, departments: store.departments, departmentLocations: deptLocs, locations, now: Date.now() });
}

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
};

/** the store's floor, walls and shelving, drawn once */
function drawStore(svg: SVGSVGElement) {
  const xs = store.nodes.map((n) => n.x);
  const ys = store.nodes.map((n) => n.y);
  const outline: [number, number][] = store.outline ?? [
    [Math.min(...xs) - 4, Math.min(...ys) - 4],
    [Math.max(...xs) + 4, Math.min(...ys) - 4],
    [Math.max(...xs) + 4, Math.max(...ys) + 4],
    [Math.min(...xs) - 4, Math.max(...ys) + 4],
  ];
  const ox = outline.map((p) => p[0]);
  const oy = outline.map((p) => p[1]);
  const [x0, y0, x1, y1] = [Math.min(...ox), Math.min(...oy), Math.max(...ox), Math.max(...oy)];
  svg.setAttribute("viewBox", `${x0 - 2} ${y0 - 2} ${x1 - x0 + 4} ${y1 - y0 + 4}`);
  el("polygon", { points: outline.map((p) => p.join(",")).join(" "), class: "d-floor" }, svg);
  const g = el("g", { class: "d-fixtures" }, svg);
  for (const f of store.fixtures ?? []) {
    if (!f.polygon?.length) continue;
    const fill = deptColor.get(f.department ?? "") ?? "#ffffff";
    el("polygon", { points: f.polygon.map((p) => p.join(",")).join(" "), fill, "fill-opacity": 0.32 }, g);
  }
  return el("g", { class: "d-route" }, svg);
}

function drawRoute(layer: SVGGElement, legs: { path: string[] }[], stops: { id: string; locationId?: string }[]) {
  layer.replaceChildren();
  const pts = legs.flatMap((l) => l.path).map((id) => graph.nodes.get(id)).filter((n): n is NonNullable<typeof n> => !!n);
  if (pts.length > 1) {
    el("polyline", { points: pts.map((p) => `${p.x},${p.y}`).join(" "), class: "d-path-glow" }, layer);
    el("polyline", { points: pts.map((p) => `${p.x},${p.y}`).join(" "), class: "d-path" }, layer);
  }
  const entrance = graph.nodes.get(store.entranceId);
  if (entrance) el("circle", { cx: entrance.x, cy: entrance.y, r: 1.6, class: "d-you" }, layer);
  stops.forEach((s, i) => {
    const n = s.locationId ? graph.nodes.get(`loc:${s.locationId}`) : undefined;
    if (!n) return;
    el("circle", { cx: n.x, cy: n.y, r: 2.4, class: i === 0 ? "d-stop d-first" : "d-stop" }, layer);
    const t = el("text", { x: n.x, y: n.y + 0.9, class: i === 0 ? "d-n d-first" : "d-n" }, layer);
    t.textContent = String(i + 1);
  });
}

export function mount(root: HTMLElement) {
  const input = root.querySelector<HTMLTextAreaElement>("[data-demo-list]")!;
  const button = root.querySelector<HTMLButtonElement>("[data-demo-route]")!;
  const svg = root.querySelector<SVGSVGElement>("[data-demo-map]")!;
  const order = root.querySelector<HTMLOListElement>("[data-demo-order]")!;
  const sum = root.querySelector<HTMLElement>("[data-demo-summary]")!;
  const note = root.querySelector<HTMLElement>("[data-demo-note]")!;
  const link = root.querySelector<HTMLAnchorElement>("[data-demo-app]")!;
  const layer = drawStore(svg);
  root.dataset.ready = "true";

  let pending = false;
  const run = () => {
    const items = parse(input.value);
    if (!items.length) return;
    const results: ResolveResult[] = resolve(items);
    const stops: Stop[] = [];
    const left: string[] = [];
    results.forEach((r, i) => {
      const s = toStop(r);
      if (s && s.locationIds.length) stops.push({ ...s, name: items[i] });
      else left.push(items[i]);
    });
    if (!stops.length) {
      order.replaceChildren();
      layer.replaceChildren();
      sum.textContent = "";
      note.textContent = "None of these has a shelf in Grosher's catalog yet.";
      return;
    }
    const route = router.solve({ stops });
    const inOrder = router.routeForOrder(stops);
    const byId = new Map(stops.map((s) => [s.id, s]));
    // the visit order with the shelf each stop was routed to (a multi-shelf item takes the one on the way)
    const placed = route.legs.filter((l) => l.stopId).map((l) => ({ id: l.stopId!, name: byId.get(l.stopId!)?.name ?? l.stopId!, locationId: l.locationId }));
    drawRoute(layer, route.legs, placed);
    const span = (cls: string, text: string) => Object.assign(document.createElement("span"), { className: cls, textContent: text });
    order.replaceChildren(
      ...placed.map((p) => {
        const li = document.createElement("li");
        li.append(span("d-item", p.name), span("d-shelf", grosher.categories.find((c) => c.locationId === p.locationId)?.group ?? ""));
        return li;
      }),
    );
    const pct = Math.round(100 * (1 - route.distanceM / inOrder.distanceM));
    sum.replaceChildren(
      "In your order ",
      span("num", String(Math.round(inOrder.distanceM))),
      " m → Grosher ",
      span("num now", String(Math.round(route.distanceM))),
      " m ",
      span("d-pct", pct > 0 ? `(${pct}% shorter)` : "(your order was already the shortest)"),
    );
    const missing = left.length ? `No shelf yet for ${left.join(", ")}.` : "";
    note.textContent = !full && !pending ? `${missing} The full catalog is still loading; it answers more items.`.trim() : missing;
    link.href = `${APP}?list=${encodeURIComponent(items.join(","))}`;
    root.dataset.routed = "true";
    // the full catalog lands after a first route: route again with it, once
    if (!full && !pending) {
      pending = true;
      fullReady.then(() => run());
    }
  };
  button.addEventListener("click", run);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
  });
  return run;
}
