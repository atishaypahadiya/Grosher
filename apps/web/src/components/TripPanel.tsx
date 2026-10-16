import { useState } from "react";
import type { Stop, StoreGraph } from "@grosher/core";
import { isDone, nextLeg, nextStop, type TripState, type TripSummary } from "../lib/trip.ts";
import { describeLocation, metres } from "../lib/format.ts";
import { IconCheck } from "./Icons.tsx";
import { resolveOne } from "../lib/resolve.ts";

export interface TripPanelProps {
  store: StoreGraph;
  catalog: Stop[];
  trip: TripState;
  summary: TripSummary;
  onGotIt: () => void;
  onSkip: () => void;
  onAdd: (stop: Stop) => void;
}

/** Interim trip sheet; the 3D restyle (DESIGN.md §5 Trip) replaces its chrome. */
export function TripPanel({ store, catalog, trip, onGotIt, onSkip, onAdd }: TripPanelProps) {
  const leg = nextLeg(trip);
  const stop = nextStop(trip);
  const position = trip.got.length + trip.skipped.length + 1;
  const total = trip.original.length;
  if (!leg || !stop || isDone(trip)) return null;

  return (
    <section className="panel glass sheet" aria-label="Trip">
      <p className="eyebrow now progress">
        Next · {position} of {total}
      </p>
      <h2 className="next-name">{stop.name}</h2>
      <p className="next-where">
        {describeLocation(store, leg.locationId)}, {metres(leg.distanceM)} from here
      </p>
      <div className="actions">
        <button type="button" className="pill lime primary" onClick={onGotIt}>
          <IconCheck />
          Got it
        </button>
        <button type="button" className="pill primary" onClick={onSkip}>
          Not here
        </button>
      </div>
      {trip.remaining.length > 1 && (
        <p className="note">
          Then{" "}
          {trip.route.legs
            .filter((l) => l.stopId !== null)
            .slice(1)
            .map((l) => l.label)
            .join(", ")}
          , then checkout.
        </p>
      )}
      <AddItem catalog={catalog} trip={trip} onAdd={onAdd} />
    </section>
  );
}

function AddItem({ catalog, trip, onAdd }: { catalog: Stop[]; trip: TripState; onAdd: (s: Stop) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const name = text.trim();
    if (!name) return;
    const stop = resolveOne(name, catalog);
    if (!stop) {
      setError(`${name} is not in this store's catalog.`);
      return;
    }
    if (trip.got.some((s) => s.id === stop.id)) {
      setError(`${stop.name} is already in the cart.`);
      return;
    }
    setError(null);
    setText("");
    onAdd(stop);
  };
  return (
    <form
      className="add-item"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="field">
        <span className="field-label">Forgot something? Add it to this trip</span>
        <div className="row">
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. coffee" autoCapitalize="none" />
          <button type="submit" className="pill">
            Add
          </button>
        </div>
      </label>
      {error && <p className="note warn">{error}</p>}
    </form>
  );
}
