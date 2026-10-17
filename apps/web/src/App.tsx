import { useEffect, useMemo, useState } from "react";
import { Router, WalkGraph, type Stop } from "@grosher/core";
import { demoSupercenter } from "@grosher/stores";
import { Ground } from "./components/Ground.tsx";
import { ListScreen } from "./components/ListScreen.tsx";
import { TripScreen } from "./components/TripScreen.tsx";
import { CheckoutScreen } from "./components/CheckoutScreen.tsx";
import { EditorScreen } from "./editor/EditorScreen.tsx";
import { useResolution } from "./lib/useResolution.ts";
import { toStop } from "@grosher/core";
import { PickerSheet } from "./components/PickerSheet.tsx";
import { ListsSheet } from "./components/ListsSheet.tsx";
import { useLists } from "./lib/useLists.ts";
import { draftIsUnsaved, predictUsual } from "./lib/lists.ts";
import { addItem, fromSnapshot, gotIt, isDone, skipStop, startTrip, toSnapshot, type TripSnapshot, type TripState } from "./lib/trip.ts";
import { load, save } from "./lib/storage.ts";

const TRIP_KEY = "grosher.trip";
const NOTES_KEY = "grosher.notes";
const FLAT_KEY = "grosher.flat";

function useHash() {
  const [hash, setHash] = useState(() => (typeof location !== "undefined" ? location.hash : ""));
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const bundle = demoSupercenter;
  const { store, catalog } = bundle;
  const router = useMemo(() => new Router(new WalkGraph(store)), [store]);

  const listsState = useLists(store.storeId);
  const { items, setItems } = listsState;
  const [listsOpen, setListsOpen] = useState(false);
  const usualToday = useMemo(() => predictUsual(listsState.lists), [listsState.lists]);
  const [notes, setNotes] = useState<string[]>(() => load<string[]>(NOTES_KEY, []));
  useEffect(() => save(NOTES_KEY, notes), [notes]);
  const noted = useMemo(() => new Set(notes.map((n) => n.toLowerCase())), [notes]);
  const note = (name: string) => setNotes((n) => (n.includes(name) ? n : [...n, name]));

  const [trip, setTrip] = useState<TripState | null>(() => fromSnapshot(router, catalog, load<TripSnapshot | null>(TRIP_KEY, null)));
  useEffect(() => save(TRIP_KEY, trip ? toSnapshot(trip) : null), [trip]);
  const [flat, setFlat] = useState<boolean>(() => load<boolean>(FLAT_KEY, false));
  useEffect(() => save(FLAT_KEY, flat), [flat]);
  const [paused, setPaused] = useState(false);

  const res = useResolution(bundle, items);
  const stops = useMemo(() => res.results.map(toStop).filter((s): s is Stop => !!s), [res.results]);
  const notFound = useMemo(() => res.results.filter((r) => !r.locationIds.length).map((r) => r.query), [res.results]);
  const plan = useMemo(() => (stops.length ? router.solve({ stops }) : null), [stops, router]);
  const baselineM = useMemo(() => (stops.length ? router.routeForOrder(stops).distanceM : 0), [stops, router]);
  const [picking, setPicking] = useState<{ name: string; promote: boolean } | null>(null);
  const tagsFor = (name: string) => res.results.find((r) => r.query === name)?.tags;
  const picker = picking && (
    <PickerSheet
      store={store}
      itemName={picking.name}
      onPick={(locationId) => {
        res.place(picking.name, locationId, tagsFor(picking.name), picking.promote);
        note(picking.name);
        setPicking(null);
      }}
      onClose={() => setPicking(null)}
    />
  );

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

  if (hash === "#/edit") {
    return (
      <EditorScreen
        bundle={bundle}
        onExit={() => {
          location.hash = "";
        }}
      />
    );
  }

  if (trip && !isDone(trip) && !paused) {
    return (
      <>
        <Ground />
        <TripScreen
          bundle={{ ...bundle, catalog: res.catalog }}
          router={router}
          trip={trip}
          flat={flat}
          onFlatChange={setFlat}
          onGotIt={() => {
            const leg = trip.route.legs[0];
            const stop = trip.remaining.find((s) => s.id === leg?.stopId);
            if (stop && leg?.locationId) res.gotIt(stop.name, leg.locationId, stop.tags);
            setTrip(gotIt(router, trip));
          }}
          onSkip={() => {
            const stop = trip.remaining.find((s) => s.id === trip.route.legs[0]?.stopId);
            if (stop) res.notHere(stop.name);
            setTrip(skipStop(router, trip));
          }}
          onAdd={(stop: Stop) => setTrip(addItem(router, trip, stop))}
          onBack={() => setPaused(true)}
        />
      </>
    );
  }

  if (trip && isDone(trip)) {
    return (
      <>
        <Ground />
        <CheckoutScreen
          store={store}
          router={router}
          trip={trip}
          usualSaved={listsState.lists.some((l) => l.kind === "usual" && l.items.join("\n") === trip.got.map((s) => s.name).join("\n"))}
          noted={noted}
          onNote={(name) => setPicking({ name, promote: true })}
          onSaveUsual={() => listsState.saveUsual(trip.got.map((s) => s.name), trip.doneAt)}
          onClose={() => setTrip(null)}
        />
        {picker}
      </>
    );
  }

  return (
    <>
      <Ground />
      <ListScreen
        store={store}
        items={items}
        results={res.results}
        plan={plan}
        baselineM={baselineM}
        usual={usualToday ? { id: usualToday.id, name: usualToday.name, count: usualToday.items.length } : null}
        asking={res.asking}
        warming={res.warming}
        offline={res.offline}
        offlineNote={res.offlineNote}
        onAdd={addItems}
        onRemove={(name) => setItems((cur) => cur.filter((n) => n !== name))}
        onLoadUsual={() => usualToday && listsState.loadList(usualToday.id)}
        onOpenLists={() => setListsOpen(true)}
        onTellWhere={(name) => setPicking({ name, promote: false })}
        resume={trip && paused ? { remaining: trip.remaining.length, distanceM: trip.route.legs.reduce((s, l) => s + l.distanceM, 0) } : null}
        onRoute={() => {
          if (trip && paused) setPaused(false);
          else if (stops.length) setTrip(startTrip(router, stops, notFound));
        }}
      />
      {listsOpen && (
        <ListsSheet
          lists={listsState.lists}
          history={[]}
          draftUnsaved={draftIsUnsaved(listsState.lists)}
          draftCount={items.length}
          onLoad={(id) => {
            listsState.loadList(id);
            setListsOpen(false);
          }}
          onDelete={listsState.deleteList}
          onRename={listsState.renameList}
          onSaveDraft={(name) => listsState.saveDraftAs(name)}
          onOpenRecord={() => {}}
          onClose={() => setListsOpen(false)}
        />
      )}
      {picker}
    </>
  );
}
