// The map editor (DESIGN.md §5 Editor): cream chrome, 64px tool rail, flat
// map, layer pills, scale bar, 320px inspector. Desktop 1280.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Fixture, StoreGraph } from "@grosher/core";
import type { StoreBundle } from "@grosher/stores";
import type { EditorFocus } from "../lib/reset.ts";
import { bandCounts, locationMarks } from "./confidence.ts";
import { StoreMap, type MapSelection, type ViewBox } from "../components/StoreMap.tsx";
import { load, save } from "../lib/storage.ts";
import { Inspector } from "./Inspector.tsx";
import { Preview3D } from "./Preview3D.tsx";
import { buildExport, canWritePackage, downloadAll, importFiles, pickPackageDir, toTextureJpeg, writePackage, type TextureFile } from "./io.ts";
import {
  addEdge,
  addFixtureRect,
  addItemAt,
  addLocation,
  addNode,
  deleteEdge,
  deleteFixture,
  deleteLocation,
  deleteNode,
  nearestEdge,
  nearestNode,
  pick,
  removeItemFrom,
  reverseEdge,
  setDepartmentTexture,
  setDoor,
  stats,
  updateEdge,
  updateFixture,
  updateLocation,
  updateNode,
  validateDraft,
  type Draft,
  type Pt,
  type Selection,
} from "./model.ts";
import { IconCorridor, IconCube, IconCursor, IconDoor, IconFixture, IconImage, IconPin, IconRuler, IconClose } from "../components/Icons.tsx";
import { moveBy, scaleAbout, withWidth, type Underlay } from "./underlay.ts";
import { slotFor } from "@grosher/stores";
import { loadLearning, saveLearning } from "../lib/learning.ts";
import { loadLists, mergeImported as mergeLists, saveLists, type List } from "../lib/lists.ts";
import { loadHistory, mergeImported as mergeHistory, saveHistory, type TripRecord } from "../lib/history.ts";
import type { ItemMemory } from "@grosher/core";
import type { Personal } from "./io.ts";

type Tool = "select" | "corridor" | "fixture" | "location" | "doors" | "texture" | "measure";
const TOOLS: { id: Tool; label: string; icon: ReactNode }[] = [
  { id: "select", label: "Select", icon: <IconCursor /> },
  { id: "corridor", label: "Corridor", icon: <IconCorridor /> },
  { id: "fixture", label: "Fixture", icon: <IconFixture /> },
  { id: "location", label: "Shelf location", icon: <IconPin /> },
  { id: "doors", label: "Entrance, exit, checkout", icon: <IconDoor /> },
  { id: "texture", label: "Texture", icon: <IconImage /> },
  { id: "measure", label: "Measure", icon: <IconRuler /> },
];

interface Layers {
  graph: boolean;
  fixtures: boolean;
  /** dot fill by band, misses as a count */
  confidence: boolean;
  /** only locations not confirmed in 90 days or in the guess band */
  stale: boolean;
  locations: boolean;
  textures: boolean;
  underlay: boolean;
}

const draftKey = (storeId: string) => `grosher.editor.${storeId}`;

export function EditorScreen({ bundle, onExit, focus = null }: { bundle: StoreBundle; onExit: () => void; focus?: EditorFocus | null }) {
  // a "possibly reset" review: the aisle in question is highlighted and its items listed until closed
  const [focusOpen, setFocusOpen] = useState(!!focus);
  const focusFixtures = useMemo(() => (focus?.aisle ? (bundle.store.fixtures ?? []).filter((f) => f.aisle === focus.aisle) : []), [bundle.store.fixtures, focus?.aisle]);
  const packaged = useMemo<Draft>(() => ({ store: bundle.store, catalog: bundle.catalog }), [bundle]);
  const [draft, setDraftState] = useState<Draft>(() => load<Draft | null>(draftKey(bundle.store.storeId), null) ?? packaged);
  const setDraft = useCallback((d: Draft) => setDraftState(d), []);
  useEffect(() => save(draftKey(bundle.store.storeId), draft), [draft, bundle.store.storeId]);

  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<Selection>(null);
  const [layers, setLayers] = useState<Layers>({ graph: true, fixtures: true, locations: true, confidence: false, stale: false, textures: false, underlay: true });
  const [issues, setIssues] = useState<ReturnType<typeof validateDraft> | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const [viewInfo, setViewInfo] = useState<{ view: ViewBox; upp: number }>({ view: { x: 0, y: 0, w: 1, h: 1 }, upp: 0.1 });
  const [textures, setTextures] = useState<TextureFile[]>([]);
  const [underlay, setUnderlay] = useState<Underlay | null>(null);
  const [preview, setPreview] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [personal, setPersonal] = useState<Personal>({ memory: [], lists: [], history: [] });
  // Memory, lists and history are the shopper's own. They only leave the browser when they say so.
  const [includeMemory, setIncludeMemory] = useState(false);
  useEffect(() => {
    const id = bundle.store.storeId;
    Promise.all([loadLearning(id), loadLists(id), loadHistory(id)]).then(([l, lists, history]) => setPersonal({ memory: l.memory, lists: lists.filter((x) => x.kind !== "draft"), history }));
  }, [bundle.store.storeId]);
  const memory: ItemMemory[] = personal.memory;
  const importRef = useRef<HTMLInputElement>(null);

  // tool state
  const [chainFrom, setChainFrom] = useState<string | null>(null);
  const [newOneWay, setNewOneWay] = useState(false);
  const [rectA, setRectA] = useState<Pt | null>(null);
  const [fixtureOpts, setFixtureOpts] = useState<{ kind: Fixture["kind"]; department: string; height: number }>({ kind: "shelf", department: "dry", height: 1.8 });
  const [door, setDoor_] = useState<"entrance" | "exit" | "checkout">("checkout");
  const [measure, setMeasure] = useState<Pt[]>([]);

  const textureUrls = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of draft.store.departments ?? []) {
      const t = textures.find((x) => x.deptId === d.id);
      if (t) m.set(d.id, t.url);
      else if (d.texture) m.set(d.id, bundle.textureUrl(d.texture));
    }
    return m;
  }, [draft, textures, bundle]);

  const s = useMemo(() => stats(draft), [draft]);
  const marks = useMemo(() => locationMarks(draft.store, draft.catalog, memory), [draft, memory]);
  const bands = useMemo(() => bandCounts(draft.catalog, memory), [draft.catalog, memory]);
  const pickRadius = viewInfo.upp * 10; // 10 px

  const onTap = (pt: Pt) => {
    setIssues(null);
    if (tool === "select") {
      setSelection(pick(draft.store, pt, pickRadius));
      return;
    }
    if (tool === "corridor") {
      const r = addNode(draft, pt);
      let d = r.draft;
      if (chainFrom && chainFrom !== r.id) d = addEdge(d, chainFrom, r.id, newOneWay).draft;
      setDraft(d);
      setChainFrom(r.id);
      setSelection({ kind: "node", id: r.id });
      return;
    }
    if (tool === "fixture") {
      if (!rectA) {
        setRectA(pt);
        return;
      }
      const r = addFixtureRect(draft, rectA, pt, fixtureOpts);
      setRectA(null);
      if (r.id) {
        setDraft(r.draft);
        setSelection({ kind: "fixture", id: r.id });
        setTool("select");
      }
      return;
    }
    if (tool === "location") {
      const hit = nearestEdge(draft.store, pt, Math.max(1.5, pickRadius * 2));
      if (!hit) {
        setNotice("Tap close to a corridor to drop a shelf location on it.");
        return;
      }
      const r = addLocation(draft, hit.edge.id, hit.offsetM);
      setDraft(r.draft);
      setSelection({ kind: "location", id: r.id });
      setTool("select");
      return;
    }
    if (tool === "doors") {
      const n = nearestNode(draft.store, pt, Math.max(1, pickRadius * 1.5));
      if (!n) {
        setNotice("Tap a node.");
        return;
      }
      setDraft(setDoor(draft, n.id, door));
      setSelection({ kind: "node", id: n.id });
      return;
    }
    if (tool === "measure") {
      setMeasure((m) => (m.length >= 2 ? [pt] : [...m, pt]));
    }
  };

  useEffect(() => {
    if (tool !== "corridor") setChainFrom(null);
    if (tool !== "fixture") setRectA(null);
    if (tool !== "measure") setMeasure([]);
  }, [tool]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setChainFrom(null);
        setRectA(null);
        setSelection(null);
        setIssues(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 2400);
    return () => clearTimeout(id);
  }, [notice]);

  const replaceTexture = async (deptId: string, file: File) => {
    const { blob, w, h } = await toTextureJpeg(file);
    const name = `${deptId}.jpg`;
    const url = URL.createObjectURL(blob);
    setTextures((t) => [...t.filter((x) => x.deptId !== deptId), { deptId, file: name, blob, w, h, shotAt: new Date().toISOString().slice(0, 10), url }]);
    setDraft(setDepartmentTexture(draft, deptId, name));
    setLayers((l) => ({ ...l, textures: true }));
  };

  const exportFiles = () => buildExport(draft, bundle.textures, textures, includeMemory ? personal : undefined);
  const onExport = () => {
    downloadAll(exportFiles());
    setNotice(includeMemory ? `Downloaded store.json, catalog.json, textures, memory.json (${memory.length} items) and lists.json (${personal.lists.length} lists, ${personal.history.length} trips).` : "Downloaded store.json, catalog.json and textures.");
  };
  const onWrite = async () => {
    const dir = await pickPackageDir();
    if (!dir) return;
    const written = await writePackage(dir, exportFiles());
    setNotice(`Wrote ${written.length} files into ${dir.name}/`);
  };
  const onImport = async (files: FileList | null) => {
    if (!files?.length) return;
    const r = await importFiles([...files], draft);
    setDraft(r.draft);
    setSelection(null);
    const id = bundle.store.storeId;
    if (r.lists !== undefined || r.history !== undefined) {
      const [lists, history] = await Promise.all([loadLists(id), loadHistory(id)]);
      const nextLists: List[] = mergeLists(lists, r.lists);
      const nextHistory: TripRecord[] = mergeHistory(history, r.history);
      await Promise.all([saveLists(id, nextLists), saveHistory(id, nextHistory)]);
      setPersonal((p) => ({ ...p, lists: nextLists.filter((x) => x.kind !== "draft"), history: nextHistory }));
    }
    if (Array.isArray(r.memory)) {
      const l = await loadLearning(id);
      const mem = r.memory as ItemMemory[];
      const merged = [...l.memory.filter((m) => !mem.some((x) => x.name.toLowerCase() === m.name.toLowerCase())), ...mem];
      await saveLearning(id, { ...l, memory: merged });
      setPersonal((p) => ({ ...p, memory: merged }));
    }
    setNotice(r.notes.join(" · "));
  };

  const mapSelection: MapSelection | null = selection
    ? selection.kind === "edge"
      ? { edgeId: selection.id }
      : selection.kind === "fixture"
        ? { fixtureId: selection.id }
        : selection.kind === "location"
          ? { locationId: selection.id, slot: (() => {
              const loc = draft.store.locations.find((l) => l.id === selection.id);
              return loc ? slotFor(draft.store, loc)?.rect ?? null : null;
            })() }
          : { nodeId: selection.id }
    : chainFrom
      ? { nodeId: chainFrom }
      : null;

  const underlayLive = !!underlay && layers.underlay && !underlay.locked && tool === "select";
  const underlayGestures = underlayLive
    ? {
        onDrag: (d: Pt) => setUnderlay((u) => (u ? moveBy(u, d) : u)),
        onScale: (f: number, at: Pt) => setUnderlay((u) => (u ? scaleAbout(u, f, at) : u)),
      }
    : null;
  const scaleBarPx = 10 / viewInfo.upp;
  const measureM = measure.length === 2 ? Math.hypot(measure[1].x - measure[0].x, measure[1].y - measure[0].y) : null;
  const store: StoreGraph = draft.store;

  return (
    <div className="editor">
      <header className="ed-top">
        <button type="button" className="wordmark soil-mark" onClick={onExit} title="Back to the app">
          <i className="dot" />
          grosher <span className="slash">/ editor</span>
        </button>
        <div className="ed-store">
          <span className="eyebrow soil">Store</span>
          <strong>
            {store.name ?? store.storeId} · #{store.storeId} · map v{store.version}
          </strong>
        </div>
        <div className="ed-stats">
          {s.nodes} nodes · {s.edges} edges · {s.locations} locations · {s.textures} textures · {s.unreachable} unreachable
        </div>
        <button type="button" className="pill-s" onClick={() => importRef.current?.click()}>
          Import JSON
        </button>
        <input ref={importRef} type="file" accept="application/json,.json" multiple hidden onChange={(e) => onImport(e.target.files)} />
        <button type="button" className="pill-s" onClick={() => setIssues(validateDraft(draft))}>
          Validate
        </button>
        {canWritePackage() && (
          <button type="button" className="pill-s" onClick={onWrite}>
            Write to package
          </button>
        )}
        <button type="button" className="btn-soil" onClick={onExport}>
          Export JSON
        </button>
      </header>

      <nav className="ed-rail" aria-label="Tools">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className={`rail-btn${tool === t.id ? " on" : ""}`} title={t.label} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>
            {t.icon}
          </button>
        ))}
        <div className="rail-spacer" />
        <button type="button" className="rail-btn" title="Preview in 3D" aria-label="Preview in 3D" onClick={() => setPreview(true)}>
          <IconCube />
        </button>
      </nav>

      <main className="ed-map">
        <StoreMap
          store={store}
          selection={mapSelection}
          showGraph={layers.graph}
          showFixtures={layers.fixtures}
          showLocations={layers.locations || layers.confidence || layers.stale}
          locationMarks={layers.confidence || layers.stale ? marks : null}
          staleOnly={layers.stale}
          textureUrls={layers.textures ? textureUrls : undefined}
          repeatMeters={Object.values(bundle.textures)[0]?.repeatMeters ?? 2}
          underlay={layers.underlay && underlay ? underlay : null}
          onTap={onTap}
          onHover={setHover}
          onViewChange={(view, upp) => setViewInfo({ view, upp })}
          gestureOverride={underlayGestures}
          className={`ed-canvas${underlayLive ? " underlay-live" : ""}`}
        >
          {focusOpen &&
            focusFixtures.map((f) => (
              <polygon key={`focus-${f.id}`} points={f.polygon.map((p) => p.join(",")).join(" ")} fill="rgba(212,255,74,0.35)" stroke="#0F2A1A" strokeWidth={viewInfo.upp * 1.5} strokeDasharray={`${viewInfo.upp * 4} ${viewInfo.upp * 4}`} pointerEvents="none" data-testid="focus-aisle" />
            ))}
          {underlayLive && underlay && (
            <rect x={underlay.x} y={underlay.y} width={underlay.w} height={underlay.h} fill="none" stroke="#D4FF4A" strokeWidth={viewInfo.upp * 2} strokeDasharray={`${viewInfo.upp * 6} ${viewInfo.upp * 4}`} pointerEvents="none" />
          )}
          {rectA && hover && (
            <rect x={Math.min(rectA.x, hover.x)} y={Math.min(rectA.y, hover.y)} width={Math.abs(hover.x - rectA.x)} height={Math.abs(hover.y - rectA.y)} fill="rgba(212,255,74,0.35)" stroke="#0F2A1A" strokeWidth={viewInfo.upp} strokeDasharray={`${viewInfo.upp * 4} ${viewInfo.upp * 4}`} />
          )}
          {chainFrom && hover && (() => {
            const n = store.nodes.find((x) => x.id === chainFrom);
            return n ? <line x1={n.x} y1={n.y} x2={hover.x} y2={hover.y} stroke="#0F2A1A" strokeWidth={viewInfo.upp * 1.5} strokeDasharray={`${viewInfo.upp * 4} ${viewInfo.upp * 4}`} /> : null;
          })()}
          {measure.length > 0 && (
            <g>
              <circle cx={measure[0].x} cy={measure[0].y} r={viewInfo.upp * 4} fill="#0F2A1A" />
              {measure[1] && (
                <>
                  <line x1={measure[0].x} y1={measure[0].y} x2={measure[1].x} y2={measure[1].y} stroke="#0F2A1A" strokeWidth={viewInfo.upp * 1.5} />
                  <circle cx={measure[1].x} cy={measure[1].y} r={viewInfo.upp * 4} fill="#0F2A1A" />
                  <text x={(measure[0].x + measure[1].x) / 2} y={(measure[0].y + measure[1].y) / 2 - viewInfo.upp * 8} fontSize={viewInfo.upp * 12} textAnchor="middle" fill="#0F2A1A" fontWeight={500}>
                    {measureM!.toFixed(1)} m
                  </text>
                </>
              )}
            </g>
          )}
        </StoreMap>
        {focus && focusOpen && (
          <aside className="ed-focus" aria-label="Possibly reset" data-testid="ed-focus">
            <button type="button" className="ed-focus-close" aria-label="Close review" onClick={() => setFocusOpen(false)}>
              <IconClose />
            </button>
            <span className="eyebrow soil">Possibly reset{focus.aisle ? ` · ${focus.aisle}` : ""}</span>
            <strong>
              {focus.misses} {focus.misses === 1 ? "miss" : "misses"} on {new Date(focus.date).toLocaleDateString(undefined, { weekday: "long" })}
            </strong>
            <span>Not where the map said. Move the locations, or re-survey the aisle.</span>
            <ul>
              {focus.items.map((it) => (
                <li key={it}>{it}</li>
              ))}
            </ul>
          </aside>
        )}

        <div className="layer-pills" role="group" aria-label="Layers">
          {(
            [
              ["graph", "Graph"],
              ["fixtures", "Fixtures"],
              ["locations", "Locations"],
              ["confidence", "Confidence"],
              ["stale", "Stale"],
              ["textures", "Textures"],
              ["underlay", "Underlay"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" className={`pill-s${layers[k] ? " on" : ""}`} aria-pressed={layers[k]} onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))}>
              {label}
            </button>
          ))}
        </div>

        <div className="scale-bar" aria-hidden>
          <span className="bar" style={{ width: `${Math.max(8, Math.min(240, scaleBarPx))}px` }} />
          <span>10 m</span>
          <span className="cursor">{hover ? `x ${hover.x.toFixed(1)} y ${hover.y.toFixed(1)}` : ""}</span>
        </div>
        {notice && <div className="ed-notice">{notice}</div>}
      </main>

      <Inspector
        draft={draft}
        selection={selection}
        issues={issues}
        bands={bands}
        manifest={bundle.textures}
        textures={textures}
        textureUrl={bundle.textureUrl}
        onUpdateLocation={(id, patch) => setDraft(updateLocation(draft, id, patch))}
        onDeleteLocation={(id) => {
          setDraft(deleteLocation(draft, id));
          setSelection(null);
        }}
        onAddItem={(id, name) => setDraft(addItemAt(draft, id, name))}
        onRemoveItem={(id, stop) => setDraft(removeItemFrom(draft, id, stop))}
        onUpdateFixture={(id, patch) => setDraft(updateFixture(draft, id, patch))}
        onDeleteFixture={(id) => {
          setDraft(deleteFixture(draft, id));
          setSelection(null);
        }}
        onUpdateEdge={(id, patch) => setDraft(updateEdge(draft, id, patch))}
        onReverseEdge={(id) => setDraft(reverseEdge(draft, id))}
        onDeleteEdge={(id) => {
          setDraft(deleteEdge(draft, id));
          setSelection(null);
        }}
        onUpdateNode={(id, patch) => setDraft(updateNode(draft, id, patch))}
        onDeleteNode={(id) => {
          setDraft(deleteNode(draft, id));
          setSelection(null);
        }}
        onSetDoor={(id, d) => setDraft(setDoor(draft, id, d))}
        onReplaceTexture={replaceTexture}
        onDone={() => {
          setSelection(null);
          setIssues(null);
        }}
      >
        <ToolOptions
          tool={tool}
          draft={draft}
          chainFrom={chainFrom}
          newOneWay={newOneWay}
          setNewOneWay={setNewOneWay}
          endChain={() => setChainFrom(null)}
          fixtureOpts={fixtureOpts}
          setFixtureOpts={setFixtureOpts}
          door={door}
          setDoor={setDoor_}
          measureM={measureM}
          textures={textures}
          textureUrls={textureUrls}
          onReplaceTexture={replaceTexture}
          underlay={underlay}
          setUnderlay={setUnderlay}
          onReset={() => {
            setDraft(packaged);
            setSelection(null);
            setNotice("Draft reset to the package.");
          }}
          memoryCount={memory.length}
          includeMemory={includeMemory}
          setIncludeMemory={setIncludeMemory}
        />
      </Inspector>

      {preview && <Preview3D draft={draft} bundle={bundle} textureUrls={textureUrls} onClose={() => setPreview(false)} />}
    </div>
  );
}

interface ToolOptionsProps {
  tool: Tool;
  draft: Draft;
  chainFrom: string | null;
  newOneWay: boolean;
  setNewOneWay: (v: boolean) => void;
  endChain: () => void;
  fixtureOpts: { kind: Fixture["kind"]; department: string; height: number };
  setFixtureOpts: (o: { kind: Fixture["kind"]; department: string; height: number }) => void;
  door: "entrance" | "exit" | "checkout";
  setDoor: (d: "entrance" | "exit" | "checkout") => void;
  measureM: number | null;
  textures: TextureFile[];
  textureUrls: Map<string, string>;
  onReplaceTexture: (deptId: string, file: File) => void;
  underlay: Underlay | null;
  setUnderlay: (u: Underlay | null) => void;
  onReset: () => void;
  memoryCount: number;
  includeMemory: boolean;
  setIncludeMemory: (v: boolean) => void;
}

function ToolOptions(p: ToolOptionsProps) {
  const depts = p.draft.store.departments ?? [];
  const title: Record<Tool, string> = {
    select: "Select",
    corridor: "Corridor",
    fixture: "Fixture",
    location: "Shelf location",
    doors: "Doors and lanes",
    texture: "Textures",
    measure: "Measure",
  };
  const help: Record<Tool, string> = {
    select: "Tap a node, location, corridor or fixture to edit it. Drag to pan, pinch or scroll to zoom.",
    corridor: "Tap to place nodes; each tap after the first adds a corridor from the previous node. Tap an existing node to join it. Esc ends the run.",
    fixture: "Tap two opposite corners to draw a shelf block, then set its department, height and aisle sign.",
    location: "Tap on a corridor to pin a shelf location there, then fill in the Walmart aisle, section and modular.",
    doors: "Pick what to mark, then tap a node.",
    texture: "One photo per department, tiled on every shelf of that department in 3D. 512×512 JPEG; any image is resized.",
    measure: "Tap two points.",
  };
  return (
    <>
      <span className="eyebrow soil">{title[p.tool]}</span>
      <p className="ed-sub">{help[p.tool]}</p>
      {p.tool === "corridor" && (
        <>
          <label className="ed-check">
            <input type="checkbox" checked={p.newOneWay} onChange={(e) => p.setNewOneWay(e.target.checked)} />
            New corridors are one-way
          </label>
          {p.chainFrom && (
            <button type="button" className="pill-s" onClick={p.endChain}>
              End this run ({p.chainFrom})
            </button>
          )}
        </>
      )}
      {p.tool === "fixture" && (
        <>
          <label className="ed-field">
            <span className="ed-label">Kind</span>
            <select value={p.fixtureOpts.kind} onChange={(e) => p.setFixtureOpts({ ...p.fixtureOpts, kind: e.target.value as Fixture["kind"], height: e.target.value === "counter" ? 1.0 : p.fixtureOpts.height })}>
              {["shelf", "wall", "counter", "selfcheckout", "service", "other"].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="ed-field">
            <span className="ed-label">Department</span>
            <select value={p.fixtureOpts.department} onChange={(e) => p.setFixtureOpts({ ...p.fixtureOpts, department: e.target.value })}>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ed-field">
            <span className="ed-label">Height (m)</span>
            <input type="number" step="0.1" min="0.2" value={p.fixtureOpts.height} onChange={(e) => p.setFixtureOpts({ ...p.fixtureOpts, height: Number(e.target.value) })} />
          </label>
        </>
      )}
      {p.tool === "doors" && (
        <div className="segmented" role="radiogroup" aria-label="Door kind">
          {(["entrance", "exit", "checkout"] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={p.door === d} className={p.door === d ? "on" : ""} onClick={() => p.setDoor(d)}>
              {d}
            </button>
          ))}
        </div>
      )}
      {p.tool === "measure" && p.measureM !== null && (
        <p className="ed-title">{p.measureM.toFixed(2)} m</p>
      )}
      {p.tool === "texture" && (
        <ul className="tex-list">
          {depts.map((d) => {
            const url = p.textureUrls.get(d.id);
            const t = p.textures.find((x) => x.deptId === d.id);
            return (
              <li key={d.id} className="tex-slot">
                {url ? <img src={url} alt="" className="tex-thumb" /> : <span className="tex-thumb empty" style={{ background: d.color }} />}
                <div className="tex-meta">
                  <strong>{d.name}</strong>
                  <span>{t ? `${t.file} · new, ${(t.blob.size / 1024).toFixed(0)} KB` : d.texture ?? "flat color"}</span>
                </div>
                <label className="pill-s">
                  {d.texture ? "Replace" : "Add"}
                  <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && p.onReplaceTexture(d.id, e.target.files[0])} />
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {p.tool === "select" && (
        <>
          <span className="eyebrow soil ed-section">Underlay</span>
          <p className="ed-sub">A floor-plan photo or sketch under the map, scaled in metres.</p>
          <label className="pill-s">
            {p.underlay ? "Replace image" : "Add image"}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const bmp = await createImageBitmap(f);
                const w = 60;
                p.setUnderlay({ url: URL.createObjectURL(f), x: 0, y: 0, w, h: (w * bmp.height) / bmp.width, opacity: 0.5, aspect: bmp.width / bmp.height, locked: false });
              }}
            />
          </label>
          {p.underlay && (
            <>
              <button type="button" className={`pill-s${p.underlay.locked ? "" : " on"}`} aria-pressed={!p.underlay.locked} onClick={() => p.setUnderlay({ ...p.underlay!, locked: !p.underlay!.locked })}>
                {p.underlay.locked ? "Locked · tap to move and scale" : "Unlocked · drag moves, scroll or pinch scales"}
              </button>
            <div className="ed-grid-3">
              <label className="ed-field">
                <span className="ed-label">x (m)</span>
                <input type="number" value={p.underlay.x} onChange={(e) => p.setUnderlay({ ...p.underlay!, x: Number(e.target.value) })} />
              </label>
              <label className="ed-field">
                <span className="ed-label">y (m)</span>
                <input type="number" value={p.underlay.y} onChange={(e) => p.setUnderlay({ ...p.underlay!, y: Number(e.target.value) })} />
              </label>
              <label className="ed-field">
                <span className="ed-label">width (m)</span>
                <input type="number" value={p.underlay.w} onChange={(e) => p.setUnderlay(withWidth(p.underlay!, Number(e.target.value)))} />
              </label>
              <label className="ed-field">
                <span className="ed-label">opacity</span>
                <input type="range" min="0" max="1" step="0.05" value={p.underlay.opacity} onChange={(e) => p.setUnderlay({ ...p.underlay!, opacity: Number(e.target.value) })} />
              </label>
            </div>
            </>
          )}
          <span className="eyebrow soil ed-section">Draft</span>
          <p className="ed-sub">Edits autosave in this browser. Export JSON or Write to package to ship them.</p>
          <label className="ed-check">
            <input type="checkbox" checked={p.includeMemory} onChange={(e) => p.setIncludeMemory(e.target.checked)} />
            Include my item memory ({p.memoryCount} {p.memoryCount === 1 ? "item" : "items"}), lists and trip history in the export
          </label>
          <button type="button" className="link rose" onClick={p.onReset}>
            Reset draft to the package
          </button>
        </>
      )}
    </>
  );
}
