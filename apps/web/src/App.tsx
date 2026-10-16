import { useEffect, useMemo, useState } from "react";
import { Router, WalkGraph, type Stop } from "@grosher/core";
import { demoSupercenter } from "@grosher/stores";
import { Ground } from "./components/Ground.tsx";
import { ListScreen } from "./components/ListScreen.tsx";
import { StoreMap } from "./components/StoreMap.tsx";
import { TripPanel } from "./components/TripPanel.tsx";
import { CheckoutScreen } from "./components/CheckoutScreen.tsx";
import { resolveItems } from "./lib/resolve.ts";
import { addItem, fromSnapshot, gotIt, isDone, skipStop, startTrip, summarize, toSnapshot, type TripSnapshot, type TripState } from "./lib/trip.ts";
import { load, save } from "./lib/storage.ts";

const ITEMS_KEY = "grosher.items";
const TRIP_KEY = "grosher.trip";
const USUAL_KEY = "grosher.usual";
const NOTES_KEY = "grosher.notes";

export function App() {
  const bundle = demoSupercenter;
  const { store, catalog } = bundle;
  const router = useMemo(() => new Router(new WalkGraph(store)), [store]);

  const [items, setItems] = useState<string[]>(() => load<string[]>(ITEMS_KEY, []));
  useEffect(() => save(ITEMS_KEY, items), [items]);
  const [usual, setUsual] = useState<string[] | null>(() => load<string[] | null>(USUAL_KEY, null));
  useEffect(() => save(USUAL_KEY, usual), [usual]);
  const [notes, setNotes] = useState<string[]>(() => load<string[]>(NOTES_KEY, []));
  useEffect(() => save(NOTES_KEY, notes), [notes]);
  const noted = useMemo(() => new Set(notes.map((n) => n.toLowerCase())), [notes]);
  const note = (name: string) => setNotes((n) => (n.includes(name) ? n : [...n, name]));

  const [trip, setTrip] = useState<TripState | null>(() => fromSnapshot(router, catalog, load<TripSnapshot | null>(TRIP_KEY, null)));
  useEffect(() => save(TRIP_KEY, trip ? toSnapshot(trip) : null), [trip]);

  const resolution = useMemo(() => resolveItems(items, catalog), [items, catalog]);
  const plan = useMemo(() => (resolution.stops.length ? router.solve({ stops: resolution.stops }) : null), [resolution, router]);
  const baselineM = useMemo(() => (resolution.stops.length ? router.routeForOrder(resolution.stops).distanceM : 0), [resolution, router]);

  const addItems = (names: string[]) =>
    setItems((cur) => {
      const seen = new Set(cur.map((n) => n.toLowerCase()));
      const out = [...cur];
      for (const n of names) {
        const key = n.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          out.push(n);
        }
      }
      return out;
    });

  if (trip && !isDone(trip)) {
    const summary = summarize(router, trip);
    return (
      <>
        <Ground />
        <div className="app">
          <header className="topbar">
            <span className="brand">Grosher</span>
            <span className="store-name">{store.name}</span>
            <span className="mode">On the trip</span>
          </header>
          <div className="map-wrap">
            <StoreMap
              store={store}
              route={trip.route}
              currentNodeId={trip.route.legs[0]?.stopId ? trip.route.legs[0].nodeId : null}
              positionNodeId={trip.positionNodeId}
              walkedPath={trip.visited}
              doneNodeIds={trip.doneNodeIds}
              className="app-map"
            />
          </div>
          <TripPanel
            store={store}
            catalog={catalog}
            trip={trip}
            summary={summary}
            onGotIt={() => setTrip(gotIt(router, trip))}
            onSkip={() => setTrip(skipStop(router, trip))}
            onAdd={(stop: Stop) => setTrip(addItem(router, trip, stop))}
          />
        </div>
      </>
    );
  }

  if (trip) {
    return (
      <>
        <Ground />
        <CheckoutScreen
          store={store}
          router={router}
          trip={trip}
          usualSaved={!!usual && usual.join("\n") === trip.original.map((s) => s.name).join("\n")}
          noted={noted}
          onNote={note}
          onSaveUsual={() => setUsual(trip.original.map((s) => s.name))}
          onClose={() => setTrip(null)}
        />
      </>
    );
  }

  return (
    <>
      <Ground />
      <ListScreen
        store={store}
        items={items}
        resolution={resolution}
        plan={plan}
        baselineM={baselineM}
        usual={usual}
        noted={noted}
        onAdd={addItems}
        onRemove={(name) => setItems((cur) => cur.filter((n) => n !== name))}
        onLoadUsual={() => usual && setItems(usual)}
        onNote={note}
        onRoute={() => resolution.stops.length && setTrip(startTrip(router, resolution.stops, resolution.notFound))}
      />
    </>
  );
}
