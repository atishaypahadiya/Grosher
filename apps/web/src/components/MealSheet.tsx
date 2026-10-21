// Cook mode (lib/meals.ts): type dishes and how many are eating, review what to buy, add it to the list. Two steps in
// one deep-glass sheet. The review: each dish with where its ingredients came from (the table, or the local model,
// tagged "estimated" in the guess colour), then the merged lines rounded up to whole packs, each editable and
// removable with the dishes it is for, then "You probably have" (salt, oil, the everyday spices), unticked. Nothing
// reaches the list until "Add to list". Loaded lazily (App), with the dish table: none of it is in the first bundle.

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { IngredientInfo, PlannedDish, ShoppingLine } from "@grosher/core";
import { INGREDIENT_BY_KEY } from "@grosher/stores/meals";
import { dishAskerFor, parseDishes, planLines, resolveUnknown, tableFirst, type DishAsker, type DishState } from "../lib/meals.ts";
import type { ResolverSettings } from "../lib/settings.ts";
import { Num } from "./Num.tsx";
import { IconClose } from "./Icons.tsx";

export interface MealSheetProps {
  /** the resolver settings pick the model's path (Ollama on the Mac, or the worker); a test passes its own asker */
  settings: ResolverSettings;
  asker?: DishAsker;
  onAdd: (lines: string[]) => void;
  onClose: () => void;
}

interface Edit {
  label?: string;
  ticked?: boolean;
  removed?: boolean;
}

const PEOPLE_MAX = 12;

export function MealSheet({ settings, asker: given, onAdd, onClose }: MealSheetProps) {
  const asker = useMemo(() => given ?? dishAskerFor(settings), [given, settings]);
  const [text, setText] = useState("");
  const [people, setPeople] = useState(2);
  const [states, setStates] = useState<DishState[] | null>(null);
  const [planned, setPlanned] = useState<PlannedDish[]>([]);
  const [adHoc, setAdHoc] = useState<IngredientInfo[]>([]);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  // a newer plan (or closing) outdates answers still on their way
  const run = useRef(0);
  useEffect(() => () => void run.current++, []);

  const ask = (queries: string[]) => {
    const id = run.current;
    void resolveUnknown(queries, asker, (q, r) => {
      if (run.current !== id) return;
      setStates((cur) => cur?.map((s) => (s.query !== q ? s : r ? r.state : { ...s, status: "unanswered" })) ?? cur);
      if (r) {
        setPlanned((cur) => [...cur.filter((p) => p.query !== q), r.planned]);
        setAdHoc((cur) => [...cur, ...r.adHoc.filter((a) => !cur.some((c) => c.key === a.key))]);
      }
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const queries = parseDishes(text);
    if (!queries.length) return;
    run.current++;
    const t = tableFirst(queries);
    setStates(t.states);
    setPlanned(t.planned);
    setAdHoc([]);
    setEdits({});
    if (t.unknown.length) ask(t.unknown);
  };

  // the dishes in the order they were typed, so a model answer arriving late does not reshuffle them
  const order = useMemo(() => new Map((states ?? []).map((s, i) => [s.query, i])), [states]);
  const ordered = useMemo(() => [...planned].sort((a, b) => (order.get(a.query) ?? 0) - (order.get(b.query) ?? 0)), [planned, order]);
  const lines = useMemo(() => planLines(ordered, people, adHoc), [ordered, people, adHoc]);
  const edit = (key: string, e: Edit) => setEdits((cur) => ({ ...cur, [key]: { ...cur[key], ...e } }));
  const ticked = (l: ShoppingLine) => edits[l.key]?.ticked ?? (!l.pantry && !l.optional);
  const labelOf = (l: ShoppingLine) => edits[l.key]?.label ?? l.label;
  const shown = lines.filter((l) => !edits[l.key]?.removed);
  const buy = shown.filter((l) => !l.pantry);
  const pantry = shown.filter((l) => l.pantry);
  const chosen = shown.filter((l) => ticked(l) && labelOf(l).trim());
  const asking = states?.some((s) => s.status === "asking") ?? false;
  const unanswered = states?.filter((s) => s.status === "unanswered") ?? [];
  const estimated = states?.some((s) => s.status === "model") ?? false;
  const nameOf = (key: string) => (INGREDIENT_BY_KEY.get(key)?.name ?? adHoc.find((a) => a.key === key)?.name ?? key).toLowerCase();

  const row = (l: ShoppingLine) => (
    <li key={l.key} className="meal-line" data-testid="meal-line" data-pantry={l.pantry || undefined}>
      <input type="checkbox" className="meal-tick" checked={ticked(l)} onChange={(e) => edit(l.key, { ticked: e.target.checked })} aria-label={`Buy ${labelOf(l)}`} />
      <div className="meal-line-main">
        <input className="meal-label" value={labelOf(l)} onChange={(e) => edit(l.key, { label: e.target.value })} aria-label={`Edit ${l.name}`} autoCapitalize="none" autoCorrect="off" />
        <span className="meal-for">
          for: {l.dishes.join(", ")}
          {l.optional && <span className="meal-tag">optional</span>}
          {l.estimated && <span className="meal-tag guess">estimated</span>}
        </span>
      </div>
      <button type="button" className="pill circle ghost meal-remove" aria-label={`Remove ${l.name}`} onClick={() => edit(l.key, { removed: true })}>
        <IconClose />
      </button>
    </li>
  );

  return (
    <div className="picker" role="dialog" aria-label="Plan meals" data-testid="meal-sheet">
      <div className="picker-sheet glass-deep sheet meal-sheet">
        <div className="picker-head">
          <div>
            <span className="eyebrow now">Cook mode</span>
            <h2 className="title">Plan meals</h2>
          </div>
          <button type="button" className="pill circle" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>

        {!states ? (
          <form className="meal-form" onSubmit={submit}>
            <label className="st-field">
              <span className="eyebrow">Dishes</span>
              <textarea
                className="meal-dishes"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="dal chawal, rajma, pasta arrabbiata"
                aria-label="Dishes"
                rows={3}
                autoCapitalize="none"
                autoCorrect="off"
                autoFocus
              />
            </label>
            <div className="meal-people">
              <span className="eyebrow">People</span>
              <div className="row">
                <button type="button" className="pill circle ghost" aria-label="Fewer people" disabled={people <= 1} onClick={() => setPeople((n) => Math.max(1, n - 1))}>
                  −
                </button>
                <Num value={people} className="meal-count" />
                <button type="button" className="pill circle ghost" aria-label="More people" disabled={people >= PEOPLE_MAX} onClick={() => setPeople((n) => Math.min(PEOPLE_MAX, n + 1))}>
                  +
                </button>
              </div>
            </div>
            <p className="st-note">Commas between dishes. Quantities are estimates, scaled from two servings and rounded up to whole packs. You review everything before it goes on your list.</p>
            <button type="submit" className="pill lime meal-go" disabled={!parseDishes(text).length}>
              Make the list
            </button>
          </form>
        ) : (
          <>
            <div className="meal-summary">
              <span>
                <Num value={states.length} /> {states.length === 1 ? "dish" : "dishes"} · <Num value={people} /> {people === 1 ? "person" : "people"}
              </span>
              <div className="row">
                <button type="button" className="pill circle ghost" aria-label="Fewer people" disabled={people <= 1} onClick={() => setPeople((n) => Math.max(1, n - 1))}>
                  −
                </button>
                <button type="button" className="pill circle ghost" aria-label="More people" disabled={people >= PEOPLE_MAX} onClick={() => setPeople((n) => Math.min(PEOPLE_MAX, n + 1))}>
                  +
                </button>
                <button type="button" className="pill ghost" onClick={() => (run.current++, setStates(null))}>
                  Change
                </button>
              </div>
            </div>
            <div className="meal-scroll">
              <ul className="meal-dishes-list" aria-label="Dishes">
                {states.map((s) => {
                  const p = planned.find((x) => x.query === s.query);
                  return (
                    <li key={s.query} className="meal-dish" data-status={s.status} data-testid="meal-dish">
                      <div className="meal-dish-head">
                        <span className="meal-dish-name">{s.name}</span>
                        {s.status === "model" && <span className="meal-tag guess">estimated</span>}
                      </div>
                      {s.status === "asking" && <p className="meal-dish-note">Asking the local model…</p>}
                      {s.status === "unanswered" && <p className="meal-dish-note warn">Needs your laptop's model · add its ingredients by hand or try later</p>}
                      {p && <p className="meal-dish-items">{p.items.map((i) => nameOf(i.key)).join(", ")}</p>}
                      {s.checked && (s.checked.dropped.length > 0 || s.checked.clamped.length > 0) && (
                        <p className="meal-dish-note">
                          {s.checked.dropped.length > 0 && `Left out ${s.checked.dropped.map((d) => d.name).join(", ")} (no usable amount). `}
                          {s.checked.clamped.length > 0 && `Capped ${s.checked.clamped.map((c) => `${c.name.toLowerCase()} at ${c.to}`).join(", ")} for two.`}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              {unanswered.length > 0 && !asking && (
                <button
                  type="button"
                  className="pill ghost meal-retry"
                  onClick={() => {
                    const qs = unanswered.map((s) => s.query);
                    setStates((cur) => cur?.map((s) => (qs.includes(s.query) ? { ...s, status: "asking" } : s)) ?? cur);
                    ask(qs);
                  }}
                >
                  Try again
                </button>
              )}

              {buy.length > 0 && (
                <>
                  <h3 className="meal-section">To buy</h3>
                  <ul className="meal-lines">{buy.map(row)}</ul>
                </>
              )}
              {pantry.length > 0 && (
                <>
                  <h3 className="meal-section">You probably have</h3>
                  <ul className="meal-lines">{pantry.map(row)}</ul>
                </>
              )}
              <p className="st-note meal-honest">
                Estimates for <Num value={people} /> {people === 1 ? "person" : "people"}, rounded up to whole packs
                {estimated ? "; lines marked estimated come from the local model" : ""}.
              </p>
            </div>
            <button type="button" className="pill lime meal-go" data-testid="meal-add" disabled={!chosen.length} onClick={() => onAdd(chosen.map(labelOf).map((s) => s.trim()))}>
              {asking ? `Add ${chosen.length} now · still asking` : `Add ${chosen.length} to list`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
