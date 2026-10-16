import { useEffect, useMemo, useState } from "react";
import { Router, WalkGraph, type Stop } from "@grosher/core";
import { demoSupercenter } from "@grosher/stores";
import { StoreMap } from "./components/StoreMap.tsx";
import { ListPanel, type Plan } from "./components/ListPanel.tsx";
import { TripPanel } from "./components/TripPanel.tsx";
import { addItem, fromSnapshot, gotIt, isDone, skipStop, startTrip, summarize, toSnapshot, type TripSnapshot, type TripState } from "./lib/trip.ts";
import { load, save } from "./lib/storage.ts";

const LIST_KEY = "grosher.list";
const TRIP_KEY = "grosher.trip";

export function App() {
  const bundle = demoSupercenter;
  const { store, catalog } = bundle;
  const router = useMemo(() => new Router(new WalkGraph(store)), [store]);

  const [text, setText] = useState<string>(() => load(LIST_KEY, ""));
  useEffect(() => save(LIST_KEY, text), [text]);

  const [plan, setPlan] = useState<Plan | null>(null);
  const onPlan = (stops: Stop[], notFound: string[]) => {
    setPlan({ stops, notFound, route: router.solve({ stops }) });
  };

  const [trip, setTrip] = useState<TripState | null>(() => fromSnapshot(router, catalog, load<TripSnapshot | null>(TRIP_KEY, null)));
  useEffect(() => save(TRIP_KEY, trip ? toSnapshot(trip) : null), [trip]);

  const summary = trip ? summarize(router, trip) : null;
  const inTrip = trip !== null;
  const route = trip ? trip.route : plan?.stops.length ? plan.route : null;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Grosher</span>
        <span className="store-name">Demo Supercenter</span>
        <span className="mode">{trip ? (isDone(trip) ? "Checkout" : "On the trip") : "Plan"}</span>
      </header>
      <div className="map-wrap">
        <StoreMap
          store={store}
          route={route}
          currentNodeId={inTrip ? trip.route.legs[0]?.nodeId : null}
          positionNodeId={inTrip ? trip.positionNodeId : null}
          className="app-map"
        />
      </div>
      {trip && summary ? (
        <TripPanel
          store={store}
          catalog={catalog}
          trip={trip}
          summary={summary}
          onGotIt={() => setTrip(gotIt(router, trip))}
          onSkip={() => setTrip(skipStop(router, trip))}
          onAdd={(stop) => setTrip(addItem(router, trip, stop))}
          onFinish={() => {
            setTrip(null);
            setPlan(null);
          }}
        />
      ) : (
        <ListPanel
          store={store}
          catalog={catalog}
          text={text}
          onTextChange={setText}
          plan={plan}
          onPlan={onPlan}
          onStart={() => plan && setTrip(startTrip(router, plan.stops))}
        />
      )}
    </div>
  );
}
