import { useState } from "react";
import type { Stop } from "@grosher/core";
import type { TripState } from "../lib/trip.ts";
import { resolveOne } from "../lib/resolve.ts";

export function AddItem({ catalog, trip, onAdd }: { catalog: Stop[]; trip: TripState; onAdd: (s: Stop) => void }) {
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
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. coffee" autoCapitalize="none" autoFocus />
          <button type="submit" className="pill">
            Add
          </button>
        </div>
      </label>
      {error && <p className="note warn">{error}</p>}
    </form>
  );
}
