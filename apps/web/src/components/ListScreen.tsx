import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import type { Route, Stop, StoreGraph } from "@grosher/core";
import type { Resolution } from "../lib/resolve.ts";
import { chipFor } from "../lib/chips.ts";
import { minutesNum } from "../lib/format.ts";
import { listen, speechSupported } from "../lib/speech.ts";
import { Num } from "./Num.tsx";
import { IconArrowRight, IconChevronDown, IconMic, IconPlus } from "./Icons.tsx";

export interface ListScreenProps {
  store: StoreGraph;
  items: string[];
  resolution: Resolution;
  plan: Route | null;
  baselineM: number;
  usual: string[] | null;
  noted: Set<string>;
  onAdd: (names: string[]) => void;
  onRemove: (name: string) => void;
  onLoadUsual: () => void;
  onNote: (name: string) => void;
  onRoute: () => void;
}

/** "milk, eggs\nbread" → ["milk", "eggs", "bread"] */
export const splitItems = (text: string) =>
  text
    .split(/[\n,;]+|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);

export function ListScreen({ store, items, resolution, plan, baselineM, usual, noted, onAdd, onRemove, onLoadUsual, onNote, onRoute }: ListScreenProps) {
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => () => stopRef.current(), []);

  const byName = new Map<string, Stop>();
  for (const name of items) {
    const stop = resolution.stops.find((s) => s.id.toLowerCase() === name.toLowerCase() || s.name.toLowerCase() === name.toLowerCase());
    if (stop) byName.set(name, stop);
  }
  const placed = resolution.stops.length;

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
          placeholder={speechSupported() ? "Add items, paste, or hold to speak" : "Add items or paste a list"}
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

      <section className="list-sheet glass sheet" aria-label="Items">
        <div className="sheet-head">
          <span className="eyebrow">
            {items.length} {items.length === 1 ? "item" : "items"} · {placed} placed
          </span>
          <button type="button" className="eyebrow" onClick={() => (usual ? onLoadUsual() : setHint("Save a usual trip from the trip-done screen."))}>
            {usual ? "Usual trip" : "No usual trip yet"}
            {usual && <IconChevronDown />}
          </button>
        </div>
        {items.length === 0 ? (
          <p className="row-item muted">Nothing yet. Add the first item above.</p>
        ) : (
          <ul className="rows">
            {items.map((name) => {
              const stop = byName.get(name);
              const chip = stop ? chipFor(store, stop) : null;
              const isSel = selected === name;
              return (
                <li key={name} className="row-item">
                  <button type="button" className="row-main" onClick={() => setSelected(isSel ? null : name)} aria-expanded={isSel}>
                    <span className="name">{stop?.name ?? name}</span>
                    {!stop && <span className="sub">Not placed yet</span>}
                  </button>
                  {isSel ? (
                    <button type="button" className="chip ghost action" onClick={() => onRemove(name)}>
                      Remove
                    </button>
                  ) : chip ? (
                    <span className="chip">
                      <i className="dot" style={chip.color ? { background: chip.color } : undefined} />
                      {chip.text}
                    </span>
                  ) : noted.has(name.toLowerCase()) ? (
                    <span className="chip ghost">Noted</span>
                  ) : (
                    <button type="button" className="chip ghost action" onClick={() => onNote(name)}>
                      Tell me where
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="cta-wrap">
        {plan && placed > 0 ? (
          <>
            <button type="button" className="cta" onClick={onRoute}>
              <span className="label">
                Route {placed} {placed === 1 ? "item" : "items"}
              </span>
              <span className="metrics">
                <Num value={Math.round(plan.distanceM)} unit="m" />
                <span className="sep" aria-hidden>
                  ·
                </span>
                <Num value={minutesNum(plan.distanceM)} unit="min" />
              </span>
              <span className="go">
                <IconArrowRight />
              </span>
            </button>
            <span className="cta-caption">
              {savedPct > 0 ? `${savedPct}% shorter than walking your list in order` : "Same as walking your list in order"}
            </span>
          </>
        ) : (
          <button type="button" className="cta muted" disabled>
            <span className="label">{items.length ? "Nothing placed yet" : "Add items to route"}</span>
          </button>
        )}
      </div>
    </main>
  );
}
