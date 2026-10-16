import { useState } from "react";
import type { Stop, StoreGraph } from "@grosher/core";
import { isDone, nextLeg, nextStop, type TripState, type TripSummary } from "../lib/trip.ts";
import { describeLocation, metres, minutes } from "../lib/format.ts";
import { resolveOne } from "../lib/resolve.ts";

export interface TripPanelProps {
  store: StoreGraph;
  catalog: Stop[];
  trip: TripState;
  summary: TripSummary;
  onGotIt: () => void;
  onSkip: () => void;
  onAdd: (stop: Stop) => void;
  onFinish: () => void;
}

export function TripPanel({ store, catalog, trip, summary, onGotIt, onSkip, onAdd, onFinish }: TripPanelProps) {
  const leg = nextLeg(trip);
  const stop = nextStop(trip);
  const done = isDone(trip);
  const position = trip.got.length + trip.skipped.length + 1;
  const total = trip.original.length;

  return (
    <section className="panel" aria-label={done ? "Checkout" : "Trip"}>
      {!done && leg && stop ? (
        <>
          <p className="progress">
            Stop {position} of {total}
          </p>
          <h2 className="next-name">{stop.name}</h2>
          <p className="next-where">
            {describeLocation(store, leg.locationId)}, {metres(leg.distanceM)} from here
          </p>
          <div className="row actions">
            <button type="button" className="btn primary big" onClick={onGotIt}>
              Got it
            </button>
            <button type="button" className="btn ghost" onClick={onSkip}>
              Not here, skip
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
        </>
      ) : (
        <CheckoutCard trip={trip} summary={summary} onFinish={onFinish} />
      )}
      <AddItem catalog={catalog} trip={trip} onAdd={onAdd} />
    </section>
  );
}

function CheckoutCard({ trip, summary, onFinish }: { trip: TripState; summary: TripSummary; onFinish: () => void }) {
  const checkout = trip.route.legs.find((l) => l.label === "Checkout");
  const saved = Math.max(0, summary.savedM);
  return (
    <div className="checkout" data-testid="checkout-card">
      <h2 className="next-name">
        {trip.got.length === 0 ? "Nothing in the cart" : `${trip.got.length} in the cart`}
      </h2>
      {trip.skipped.length > 0 && (
        <p className="note warn">Not found on the shelf: {trip.skipped.map((s) => s.name).join(", ")}.</p>
      )}
      {checkout && (
        <p className="next-where">
          Checkout lane {checkout.nodeId} is {metres(checkout.distanceM)} from here.
        </p>
      )}
      <table className="stats">
        <tbody>
          <tr>
            <th scope="row">Walked</th>
            <td>{metres(summary.walkedM)}</td>
          </tr>
          <tr>
            <th scope="row">To checkout and out</th>
            <td>{metres(summary.toGoM)}</td>
          </tr>
          <tr>
            <th scope="row">Your list in typed order</th>
            <td>{metres(summary.baselineM)}</td>
          </tr>
          <tr className="saved">
            <th scope="row">Saved</th>
            <td>
              {metres(saved)}, {minutes(saved)}
            </td>
          </tr>
        </tbody>
      </table>
      <button type="button" className="btn primary big" onClick={onFinish}>
        Finish trip
      </button>
    </div>
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
        <div className="row nowrap">
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. coffee" autoCapitalize="none" />
          <button type="submit" className="btn">
            Add
          </button>
        </div>
      </label>
      {error && <p className="note warn">{error}</p>}
    </form>
  );
}
