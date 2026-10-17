import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import type { ResolveResult, Route, StoreGraph } from "@grosher/core";
import { chipForResult } from "../lib/chips.ts";
import { minutesNum } from "../lib/format.ts";
import { listen, speechSupported } from "../lib/speech.ts";
import { Num } from "./Num.tsx";
import { SourceGlyph } from "./SourceGlyph.tsx";
import { IconArrowRight, IconChevronDown, IconMic, IconPlus } from "./Icons.tsx";

export interface ListScreenProps {
  store: StoreGraph;
  items: string[];
  results: ResolveResult[];
  plan: Route | null;
  baselineM: number;
  usual: string[] | null;
  asking: boolean;
  offline: boolean;
  offlineNote?: string;
  onAdd: (names: string[]) => void;
  onRemove: (name: string) => void;
  onLoadUsual: () => void;
  onTellWhere: (name: string) => void;
  onRoute: () => void;
  /** a paused trip: the CTA resumes it instead of routing the list */
  resume?: { remaining: number; distanceM: number } | null;
}

/** "milk, eggs\nbread" → ["milk", "eggs", "bread"] */
export const splitItems = (text: string) =>
  text
    .split(/[\n,;]+|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);

export function ListScreen({ store, items, results, plan, baselineM, usual, asking, offline, offlineNote, onAdd, onRemove, onLoadUsual, onTellWhere, onRoute, resume }: ListScreenProps) {
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => () => stopRef.current(), []);

  const byQuery = new Map(results.map((r) => [r.query, r]));
  const placed = results.filter((r) => r.locationIds.length > 0).length;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const names = splitItems(draft);
    if (names.length) onAdd(names);
    setDraft("");
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (/[\n,;]/.test(text)) {
      e.preventDefault();
      onAdd(splitItems(text));
      setDraft("");
    }
  };
  const startSpeech = () => {
    if (listening) return;
    setListening(true);
    stopRef.current = listen((text) => onAdd(splitItems(text)), () => setListening(false));
  };
  const stopSpeech = () => stopRef.current();

  const savedPct = plan && baselineM > 0 ? Math.round((1 - plan.distanceM / baselineM) * 100) : 0;

  return (
    <main className="screen page list-page">
      <header className="list-head on-haze">
        <div>
          <span className="eyebrow">{store.name ?? "Store"}</span>
          <h1 className="heading">{store.address ?? store.storeId}</h1>
        </div>
        <button type="button" className="pill soil-ghost" onClick={() => setHint("One store so far: the demo Supercenter.")}>
          Change
        </button>
      </header>

      <h2 className="display on-haze list-display">
        Your list,
        <br />
        not their layout.
      </h2>

      <form className="add-pill glass" onSubmit={submit}>
        <IconPlus className="plus" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={onPaste}
          placeholder={speechSupported() ? "Add items, paste a list, or hold to speak" : "Add items or paste a list"}
          aria-label="Add items"
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="done"
        />
        {speechSupported() && (
          <button
            type="button"
            className={`mic${listening ? " listening" : ""}`}
            aria-label={listening ? "Listening, release to add" : "Hold to speak"}
            aria-pressed={listening}
            onPointerDown={startSpeech}
            onPointerUp={stopSpeech}
            onPointerCancel={stopSpeech}
            onPointerLeave={stopSpeech}
          >
            <IconMic />
          </button>
        )}
      </form>
      {hint && <p className="caption-line muted">{hint}</p>}

      <section className="list-sheet glass-deep sheet" aria-label="Items">
        <div className="sheet-head">
          <span className="eyebrow">
            {items.length} {items.length === 1 ? "item" : "items"} · {placed} placed
            {asking ? " · asking" : ""}
          </span>
          <button type="button" className="eyebrow" onClick={() => (usual ? onLoadUsual() : setHint("Save a usual trip from the trip-done screen."))}>
            {usual ? "Usual trip" : "No usual trip yet"}
            {usual && <IconChevronDown />}
          </button>
        </div>
        {offline && !asking && <p className="offline-note">{offlineNote ?? "Resolver offline · unknown items need a tap"}</p>}
        {items.length === 0 ? (
          <p className="row-item muted">Nothing yet. Add the first item above.</p>
        ) : (
          <ul className="rows">
            {items.map((name) => {
              const r = byQuery.get(name);
              const chip = r ? chipForResult(store, r) : null;
              const isSel = selected === name;
              const unknown = !r || r.source === "unknown";
              return (
                <li key={name} className="row-item" data-source={r?.source ?? "pending"}>
                  <button type="button" className="row-main" onClick={() => setSelected(isSel ? null : name)} aria-expanded={isSel}>
                    <span className="name">
                      {r && <SourceGlyph source={r.source} />}
                      {r?.canonicalName ?? name}
                    </span>
                    {r && unknown && <span className="sub">{r.department ? `Not placed yet · probably ${r.department}` : "Not placed yet"}</span>}
                  </button>
                  {isSel ? (
                    <button type="button" className="chip ghost action" onClick={() => onRemove(name)}>
                      Remove
                    </button>
                  ) : !r ? (
                    <span className="chip ghost pending" aria-label="Resolving">
                      …
                    </span>
                  ) : !unknown && chip ? (
                    <span className={`chip${r.source === "llm" ? " guess" : ""}`} style={{ opacity: 0.5 + 0.5 * Math.min(1, r.confidence) }} title={`${Math.round(r.confidence * 100)}%`}>
                      <i className="dot" style={chip.color ? { background: chip.color } : undefined} />
                      {chip.text}
                    </span>
                  ) : (
                    <button type="button" className="chip ghost action" onClick={() => onTellWhere(name)}>
                      Tell me where
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="caption-line muted edit-link">
        <a href="#/edit">Edit the map</a>
      </p>

      <div className="cta-wrap">
        <button type="button" className="cta" onClick={onRoute} disabled={!resume && (!plan || placed === 0)}>
          <span className="label">
            {resume ? `Resume trip · ${resume.remaining} left` : `Route ${placed} ${placed === 1 ? "item" : "items"}`}
          </span>
          {resume ? (
            <span className="metrics">
              <Num value={Math.round(resume.distanceM)} unit="m" />
            </span>
          ) : plan && placed > 0 && (
            <span className="metrics">
              <Num value={Math.round(plan.distanceM)} unit="m" />
              <span className="sep" aria-hidden>
                ·
              </span>
              <Num value={minutesNum(plan.distanceM)} unit="min" />
            </span>
          )}
          <span className="go">
            <IconArrowRight />
          </span>
        </button>
        <span className="cta-caption">
          {plan && placed > 0 ? (savedPct > 0 ? `${savedPct}% shorter than walking your list in order` : "Same as walking your list in order") : " "}
        </span>
      </div>
    </main>
  );
}
