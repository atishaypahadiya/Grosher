// The 320px inspector: edits whatever is selected, or shows tool options.

import { useEffect, useState, type ReactNode } from "react";
import type { Department, Fixture, GraphEdge, GraphNode, ItemTag, ShelfLocation, StoreZone } from "@grosher/core";
import { offsetForBay, slotFor, type TextureManifest } from "@grosher/stores";
import { categoriesAt, itemsAt, type Draft, type Issue, type Selection } from "./model.ts";
import type { TextureFile } from "./io.ts";
import { IconCheck } from "../components/Icons.tsx";

const TAGS: ItemTag[] = ["chilled", "frozen", "heavy", "fragile", "produce"];
const ZONES: { id: StoreZone; label: string }[] = [
  { id: "GR", label: "GR · grocery" },
  { id: "MD", label: "MD · market / deli" },
  { id: "GM", label: "GM · general merchandise" },
  { id: "BK", label: "BK · bakery" },
  { id: "FT", label: "FT · front end" },
];
const KINDS: Fixture["kind"][] = ["shelf", "wall", "counter", "selfcheckout", "service", "other"];

import type { BandCounts } from "./confidence.ts";

export interface InspectorProps {
  draft: Draft;
  selection: Selection;
  issues: Issue[] | null;
  /** entries per confidence band, shown with the validation */
  bands?: BandCounts;
  manifest: TextureManifest;
  textures: TextureFile[];
  textureUrl: (file: string) => string;
  onUpdateLocation: (id: string, patch: Partial<ShelfLocation>) => void;
  onDeleteLocation: (id: string) => void;
  onAddItem: (locationId: string, name: string) => void;
  onRemoveItem: (locationId: string, stopId: string) => void;
  onUpdateFixture: (id: string, patch: Partial<Fixture>) => void;
  onDeleteFixture: (id: string) => void;
  onUpdateEdge: (id: string, patch: Partial<GraphEdge>) => void;
  onReverseEdge: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  onUpdateNode: (id: string, patch: Partial<GraphNode>) => void;
  onDeleteNode: (id: string) => void;
  onSetDoor: (id: string, door: "entrance" | "exit" | "checkout") => void;
  onReplaceTexture: (deptId: string, file: File) => void;
  onDone: () => void;
  children?: ReactNode; // tool options when nothing is selected
}

export function Inspector(p: InspectorProps) {
  const { draft, selection } = p;
  if (p.issues) return <ValidationPanel issues={p.issues} bands={p.bands} onDone={p.onDone} />;
  if (!selection) return <aside className="inspector">{p.children}</aside>;
  if (selection.kind === "location") {
    const loc = draft.store.locations.find((l) => l.id === selection.id);
    return loc ? <LocationPanel key={loc.id} loc={loc} {...p} /> : null;
  }
  if (selection.kind === "fixture") {
    const f = (draft.store.fixtures ?? []).find((x) => x.id === selection.id);
    return f ? <FixturePanel key={f.id} fixture={f} {...p} /> : null;
  }
  if (selection.kind === "edge") {
    const e = draft.store.edges.find((x) => x.id === selection.id);
    return e ? <EdgePanel key={e.id} edge={e} {...p} /> : null;
  }
  const n = draft.store.nodes.find((x) => x.id === selection.id);
  return n ? <NodePanel key={n.id} node={n} {...p} /> : null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ed-field">
      <span className="ed-label">{label}</span>
      {children}
    </label>
  );
}

function departmentOf(draft: Draft, loc: ShelfLocation): Department | undefined {
  const f = (draft.store.fixtures ?? []).find((x) => x.aisle === loc.aisle && x.department);
  return f ? (draft.store.departments ?? []).find((d) => d.id === f.department) : undefined;
}

function LocationPanel({ loc, draft, manifest, textures, textureUrl, onUpdateLocation, onDeleteLocation, onAddItem, onRemoveItem, onReplaceTexture, onDone }: InspectorProps & { loc: ShelfLocation }) {
  const [form, setForm] = useState<ShelfLocation>(loc);
  useEffect(() => setForm(loc), [loc]);
  const [newItem, setNewItem] = useState("");
  const dept = departmentOf(draft, loc);
  const edge = draft.store.edges.find((e) => e.id === loc.edgeId);
  const items = itemsAt(draft.catalog, loc.id);
  const slot = slotFor(draft.store, loc);
  const shelfCount = slot?.params.shelves ?? 5;
  const tex = dept ? textures.find((t) => t.deptId === dept.id) : undefined;
  const texInfo = dept ? manifest[dept.id] : undefined;
  const texFile = tex?.file ?? dept?.texture;
  const texUrl = tex?.url ?? (texFile ? textureUrl(texFile) : undefined);
  const wallName = /^A\d+$/i.test(loc.aisle) ? `Aisle ${loc.aisle}` : `${loc.aisle.charAt(0)}${loc.aisle.slice(1).toLowerCase()} wall`;
  const toggleTag = (t: ItemTag) => setForm((f) => ({ ...f, tags: (f.tags ?? []).includes(t) ? (f.tags ?? []).filter((x) => x !== t) : [...(f.tags ?? []), t] }));
  const save = () => {
    onUpdateLocation(loc.id, form);
    onDone();
  };

  return (
    <aside className="inspector" aria-label="Shelf location">
      <span className="eyebrow soil">Shelf location</span>
      <h2 className="ed-title">
        {loc.id} · {wallName}
      </h2>
      <p className="ed-sub">
        Pinned to edge {edge?.id ?? "?"} at {loc.offsetM.toFixed(1)} m · {items.length} {items.length === 1 ? "item" : "items"} here
      </p>

      <div className="ed-grid-3">
        <Field label="Aisle">
          <input value={form.aisle} onChange={(e) => setForm({ ...form, aisle: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Section">
          <input value={form.bay ?? ""} placeholder="024" onChange={(e) => setForm({ ...form, bay: e.target.value || undefined })} />
        </Field>
        <Field label="Modular">
          <input value={form.modular ?? ""} placeholder="3" onChange={(e) => setForm({ ...form, modular: e.target.value || undefined })} />
        </Field>
      </div>

      {slot && (
        <div className="ed-grid-2">
          <Field label={`Bay (1–${slot.params.bays}, from the front)`}>
            <select
              value={slot.bay}
              aria-label="Bay"
              onChange={(e) => {
                const off = offsetForBay(draft.store, loc, Number(e.target.value));
                if (off !== undefined) onUpdateLocation(loc.id, { offsetM: off });
              }}
            >
              {Array.from({ length: slot.params.bays }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Bay {i + 1}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Shelf">
            <select value={form.shelf ?? Math.min(2, shelfCount - 1)} aria-label="Shelf" onChange={(e) => setForm({ ...form, shelf: Number(e.target.value) })}>
              {Array.from({ length: shelfCount }, (_, i) => (
                <option key={i} value={i}>
                  {i === 0 ? "Shelf 1 · bottom" : i === shelfCount - 1 ? `Shelf ${i + 1} · top` : `Shelf ${i + 1}`}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      <span className="ed-label">Side</span>
      <div className="segmented" role="radiogroup" aria-label="Side">
        {(
          [
            ["L", "Left"],
            ["R", "Right"],
            ["E", "Endcap"],
          ] as const
        ).map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={form.side === v} className={form.side === v ? "on" : ""} onClick={() => setForm({ ...form, side: v })}>
            {label}
          </button>
        ))}
      </div>

      <Field label="Walmart zone">
        <select value={form.zone ?? ""} onChange={(e) => setForm({ ...form, zone: (e.target.value || undefined) as StoreZone | undefined })}>
          <option value="">—</option>
          {ZONES.map((z) => (
            <option key={z.id} value={z.id}>
              {z.label}
            </option>
          ))}
        </select>
      </Field>

      <span className="ed-label">Tags</span>
      <div className="tag-row">
        {TAGS.map((t) => (
          <button key={t} type="button" className={`tag${(form.tags ?? []).includes(t) ? " on" : ""}`} aria-pressed={(form.tags ?? []).includes(t)} onClick={() => toggleTag(t)}>
            {t}
          </button>
        ))}
      </div>

      <span className="ed-label">Fixture texture</span>
      <div className="tex-slot">
        {texUrl ? <img src={texUrl} alt="" className="tex-thumb" /> : <span className="tex-thumb empty" />}
        <div className="tex-meta">
          <strong>{texFile ?? "no texture"}</strong>
          <span>
            {texInfo ? `${texInfo.w}×${texInfo.h}` : "—"} · {texInfo?.shotAt ? `shot ${texInfo.shotAt}` : "placeholder"} · tiles every {texInfo?.repeatMeters ?? 2} m
          </span>
        </div>
        {dept && (
          <label className="pill-s">
            Replace
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onReplaceTexture(dept.id, e.target.files[0])} />
          </label>
        )}
      </div>

      {(draft.categories ?? []).length > 0 && (
        <>
          <span className="eyebrow soil ed-section">Categories here</span>
          <ul className="ed-items" data-testid="categories-here">
            {categoriesAt(draft.categories, loc.id).length === 0 && <li className="muted">None · the category tool assigns one to this slot</li>}
            {categoriesAt(draft.categories, loc.id).map((c) => (
              <li key={c.id}>
                <span>{c.name}</span>
                <span className="conf">
                  {c.group} · bays {c.bays[0]}–{c.bays[1]}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <span className="eyebrow soil ed-section">Items here</span>
      <ul className="ed-items">
        {items.map((s) => (
          <li key={s.id}>
            <span>{s.name}</span>
            <span className="conf">
              {(s.confidence ?? 1).toFixed(2)}
              <button type="button" className="link rose" onClick={() => onRemoveItem(loc.id, s.id)} aria-label={`Remove ${s.name} from here`}>
                remove
              </button>
            </span>
          </li>
        ))}
        {items.length === 0 && <li className="muted-soil">Nothing placed here yet.</li>}
      </ul>
      <form
        className="ed-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (newItem.trim()) onAddItem(loc.id, newItem);
          setNewItem("");
        }}
      >
        <input value={newItem} placeholder="Add an item here" onChange={(e) => setNewItem(e.target.value)} aria-label="Add an item here" />
        <button type="submit" className="pill-s">
          Add
        </button>
      </form>

      <div className="ed-actions">
        <button type="button" className="btn-soil" onClick={save}>
          Save location
        </button>
        <button type="button" className="link rose" onClick={() => onDeleteLocation(loc.id)}>
          Delete
        </button>
      </div>
    </aside>
  );
}

function FixturePanel({ fixture: f, draft, onUpdateFixture, onDeleteFixture, onDone }: InspectorProps & { fixture: Fixture }) {
  const [form, setForm] = useState<Fixture>(f);
  useEffect(() => setForm(f), [f]);
  const depts = draft.store.departments ?? [];
  return (
    <aside className="inspector" aria-label="Fixture">
      <span className="eyebrow soil">Fixture</span>
      <h2 className="ed-title">{f.id}</h2>
      <p className="ed-sub">{f.polygon.length} corners</p>
      <Field label="Kind">
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Fixture["kind"] })}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Department">
        <select value={form.department ?? ""} onChange={(e) => setForm({ ...form, department: e.target.value || undefined })}>
          <option value="">—</option>
          {depts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="ed-grid-2">
        <Field label="Height (m)">
          <input type="number" step="0.1" min="0.2" value={form.height ?? (form.kind === "counter" ? 1.0 : 1.8)} onChange={(e) => setForm({ ...form, height: Number(e.target.value) })} />
        </Field>
        <Field label="Aisle sign">
          <input value={form.aisle ?? ""} placeholder="A12" onChange={(e) => setForm({ ...form, aisle: e.target.value.toUpperCase() || undefined })} />
        </Field>
      </div>
      <div className="ed-actions">
        <button
          type="button"
          className="btn-soil"
          onClick={() => {
            onUpdateFixture(f.id, form);
            onDone();
          }}
        >
          Save fixture
        </button>
        <button type="button" className="link rose" onClick={() => onDeleteFixture(f.id)}>
          Delete
        </button>
      </div>
    </aside>
  );
}

function EdgePanel({ edge: e, draft, onUpdateEdge, onReverseEdge, onDeleteEdge }: InspectorProps & { edge: GraphEdge }) {
  const locs = draft.store.locations.filter((l) => l.edgeId === e.id);
  return (
    <aside className="inspector" aria-label="Corridor">
      <span className="eyebrow soil">Corridor edge</span>
      <h2 className="ed-title">{e.id}</h2>
      <p className="ed-sub">
        {e.from} → {e.to} · {locs.length} {locs.length === 1 ? "location" : "locations"}
      </p>
      <label className="ed-check">
        <input type="checkbox" checked={!!e.oneWay} onChange={(ev) => onUpdateEdge(e.id, ev.target.checked ? { oneWay: true } : { oneWay: undefined })} />
        One-way ({e.from} → {e.to})
      </label>
      <div className="ed-actions">
        <button type="button" className="pill-s" onClick={() => onReverseEdge(e.id)}>
          Reverse direction
        </button>
        <button type="button" className="link rose" onClick={() => onDeleteEdge(e.id)}>
          Delete
        </button>
      </div>
      <p className="muted-soil">Use the location tool to drop a shelf location on this corridor.</p>
    </aside>
  );
}

function NodePanel({ node: n, draft, onSetDoor, onDeleteNode }: InspectorProps & { node: GraphNode }) {
  const { store } = draft;
  const degree = store.edges.filter((e) => e.from === n.id || e.to === n.id).length;
  return (
    <aside className="inspector" aria-label="Node">
      <span className="eyebrow soil">Node</span>
      <h2 className="ed-title">{n.id}</h2>
      <p className="ed-sub">
        {n.type} · x {n.x.toFixed(1)} y {n.y.toFixed(1)} · {degree} {degree === 1 ? "edge" : "edges"}
      </p>
      <span className="ed-label">Doors</span>
      <div className="tag-row">
        <button type="button" className={`tag${store.entranceId === n.id ? " on" : ""}`} onClick={() => onSetDoor(n.id, "entrance")}>
          entrance
        </button>
        <button type="button" className={`tag${store.exitId === n.id ? " on" : ""}`} onClick={() => onSetDoor(n.id, "exit")}>
          exit
        </button>
        <button type="button" className={`tag${store.checkoutIds.includes(n.id) ? " on" : ""}`} onClick={() => onSetDoor(n.id, "checkout")}>
          checkout lane
        </button>
      </div>
      <div className="ed-actions">
        <button type="button" className="link rose" onClick={() => onDeleteNode(n.id)}>
          Delete node
        </button>
      </div>
    </aside>
  );
}

function ValidationPanel({ issues, bands, onDone }: { issues: Issue[]; bands?: BandCounts; onDone: () => void }) {
  const errors = issues.filter((i) => i.level === "error");
  return (
    <aside className="inspector" aria-label="Validation">
      <span className="eyebrow soil">Validate</span>
      <h2 className="ed-title">
        {errors.length === 0 ? (
          <>
            <IconCheck /> Map is valid
          </>
        ) : (
          `${errors.length} ${errors.length === 1 ? "problem" : "problems"}`
        )}
      </h2>
      <p className="ed-sub">
        {issues.length - errors.length} {issues.length - errors.length === 1 ? "warning" : "warnings"}
      </p>
      {bands && (
        <p className="ed-sub ed-bands" data-testid="band-counts">
          {bands.total} {bands.total === 1 ? "entry" : "entries"} · {bands.confirmed} confirmed · {bands.likely} likely · {bands.guess} {bands.guess === 1 ? "guess" : "guesses"} · {bands.stale} stale
        </p>
      )}
      <ul className="ed-issues">
        {issues.map((i, k) => (
          <li key={k} className={i.level}>
            {i.text}
          </li>
        ))}
      </ul>
      <div className="ed-actions">
        <button type="button" className="btn-soil" onClick={onDone}>
          Done
        </button>
      </div>
    </aside>
  );
}


/** The category tool's panel: find a sign, pick it, then tap the slot on the map. */
export function CategoryPicker({ draft, pick, onPick }: { draft: Draft; pick: string | null; onPick: (id: string | null) => void }) {
  const [q, setQ] = useState("");
  const cats = draft.categories ?? [];
  const needle = q.trim().toLowerCase();
  const shown = (needle ? cats.filter((c) => `${c.name} ${c.group} ${c.id} ${(c.aliases ?? []).join(" ")}`.toLowerCase().includes(needle)) : cats).slice(0, 40);
  const picked = cats.find((c) => c.id === pick);
  return (
    <div className="ed-catpick" data-testid="category-picker">
      <p className="ed-sub">{picked ? `${picked.name} · now at ${picked.locationId} · tap the slot it belongs to` : "Pick a category, then tap its slot on the map."}</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search signs and categories" aria-label="Search categories" />
      <ul className="ed-items">
        {shown.map((c) => (
          <li key={c.id}>
            <button type="button" className={`ed-cat${c.id === pick ? " on" : ""}`} aria-pressed={c.id === pick} onClick={() => onPick(c.id === pick ? null : c.id)}>
              <span>{c.name}</span>
              <span className="conf">
                {c.aisle} · bays {c.bays[0]}–{c.bays[1]}
              </span>
            </button>
          </li>
        ))}
        {!shown.length && <li className="muted">No category matches.</li>}
      </ul>
    </div>
  );
}
