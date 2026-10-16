import { useState } from "react";
import type { Route, Stop, StoreGraph } from "@grosher/core";
import { parseList, resolveItems } from "../lib/resolve.ts";
import { describeLocation, metres, minutes } from "../lib/format.ts";

export interface Plan {
  stops: Stop[];
  notFound: string[];
  route: Route;
}

export interface ListPanelProps {
  store: StoreGraph;
  catalog: Stop[];
  text: string;
  onTextChange: (text: string) => void;
  plan: Plan | null;
  onPlan: (stops: Stop[], notFound: string[]) => void;
  onStart: () => void;
}

const SAMPLE = ["Bananas", "Milk", "Eggs", "Basmati rice 10 lb", "Pasta", "Chips", "Ice cream", "Bread", "Coffee"];

export function ListPanel({ store, catalog, text, onTextChange, plan, onPlan, onStart }: ListPanelProps) {
  const [empty, setEmpty] = useState(false);
  const names = parseList(text);

  const submit = () => {
    if (names.length === 0) {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    const { stops, notFound } = resolveItems(names, catalog);
    onPlan(stops, notFound);
  };

  return (
    <section className="panel" aria-label="Shopping list">
      <label className="field">
        <span className="field-label">Your list, one item per line</span>
        <textarea
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          rows={Math.min(10, Math.max(4, names.length + 1))}
          placeholder={"milk\neggs\nbananas"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>
      <div className="row">
        <button type="button" className="btn primary" onClick={submit}>
          {plan ? "Replan route" : "Plan route"}
        </button>
        <button type="button" className="btn ghost" onClick={() => onTextChange(SAMPLE.join("\n"))}>
          Use a sample list
        </button>
      </div>
      {empty && <p className="note warn">Add at least one item to plan a route.</p>}

      {plan && (
        <div className="plan">
          {plan.notFound.length > 0 && (
            <p className="note warn">
              Not found in this store: {plan.notFound.join(", ")}. Check the spelling or drop them.
            </p>
          )}
          {plan.stops.length === 0 ? (
            <p className="note">None of these items are in the catalog yet.</p>
          ) : (
            <>
              <p className="summary">
                {plan.stops.length} {plan.stops.length === 1 ? "stop" : "stops"}, {metres(plan.route.distanceM)} of walking,
                {minutes(plan.route.distanceM)}.
              </p>
              <ol className="legs">
                {plan.route.legs
                  .filter((l) => l.stopId !== null)
                  .map((l, i) => (
                    <li key={l.stopId ?? i}>
                      <span className="leg-name">{l.label}</span>
                      <span className="leg-where">{describeLocation(store, l.locationId)}</span>
                    </li>
                  ))}
              </ol>
              <button type="button" className="btn primary big" onClick={onStart}>
                Start trip
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
