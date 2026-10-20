import { usePrepareFirstStop } from "./hero/usePrepareFirst.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Router, WalkGraph, type Stop } from "@grosher/core";
import { DEFAULT_STORE, demoSupercenter, type StoreBundle } from "@grosher/stores";
import { Ground } from "./components/Ground.tsx";
import { ListScreen } from "./components/ListScreen.tsx";
import { TripScreen } from "./components/TripScreen.tsx";
import { CheckoutScreen } from "./components/CheckoutScreen.tsx";
import { EditorScreen } from "./editor/EditorScreen.tsx";
import { SurveyScreen } from "./survey/SurveyScreen.tsx";
import { storeParam, surveyedBundle } from "./survey/surveyed.ts";
import { useResolution } from "./lib/useResolution.ts";
import { toStop } from "@grosher/core";
import { PickerSheet } from "./components/PickerSheet.tsx";
import { ListsSheet } from "./components/ListsSheet.tsx";
import { SettingsSheet } from "./components/SettingsSheet.tsx";
import { loadSettings, resetSettings, saveSettings } from "./lib/settings.ts";
import { DEMO_LIST, demoWalkOn } from "./lib/demoWalk.ts";
import { requestSensors } from "./survey/sensors.ts";
import { providerFor } from "./lib/resolver.ts";
import { useLists } from "./lib/useLists.ts";
import { useHistory } from "./lib/useHistory.ts";
import { previousOf, recordFrom, type TripRecord } from "./lib/history.ts";
import { draftIsUnsaved, predictUsual } from "./lib/lists.ts";
import { addItem, fromSnapshot, gotIt, isDone, skipStop, startTrip, toSnapshot, type TripSnapshot, type TripState } from "./lib/trip.ts";
import { load, save } from "./lib/storage.ts";
import { useResetFlag } from "./lib/useResetFlag.ts";
import { bannerText, detectReset, editorHashFor, parseEditorFocus } from "./lib/reset.ts";

// per store: a trip or a note never follows the shopper into another store's map
const tripKey = (storeId: string) => `grosher.trip.${storeId}`;
const notesKey = (storeId: string) => `grosher.notes.${storeId}`;
const FLAT_KEY = "grosher.flat";
/** A Walmart survey (Story Rd) matches its signs against the Walmart taxonomy: the demo Supercenter's. */
const WALMART_REFERENCE = demoSupercenter;

function useHash() {
  const [hash, setHash] = useState(() => (typeof location !== "undefined" ? location.hash : ""));
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

/** The app on one store: Grosher unless a test hands it another (the demo Supercenter's suite). */
export function App({ bundle = DEFAULT_STORE }: { bundle?: StoreBundle } = {}) {
  const hash = useHash();
  const { store } = bundle;
  const TRIP_KEY = tripKey(store.storeId);
  const NOTES_KEY = notesKey(store.storeId);
  const router = useMemo(() => new Router(new WalkGraph(store)), [store]);

  const listsState = useLists(store.storeId, bundle.lists);
  const { items, setItems } = listsState;
  const [listsOpen, setListsOpen] = useState(false);
  const historyState = useHistory(store.storeId);
  const [viewing, setViewing] = useState<TripRecord | null>(null);
  const usualToday = useMemo(() => predictUsual(listsState.lists), [listsState.lists]);
  const [notes, setNotes] = useState<string[]>(() => load<string[]>(NOTES_KEY, []));
  useEffect(() => save(NOTES_KEY, notes), [notes]);
  const noted = useMemo(() => new Set(notes.map((n) => n.toLowerCase())), [notes]);
  const note = (name: string) => setNotes((n) => (n.includes(name) ? n : [...n, name]));

  // a paused trip restores once the full catalog is in (its stops may be seeded or imported rows)
  const [trip, setTrip] = useState<TripState | null>(null);
  const restored = useRef(false);
  // a finished trip is recorded once (the record id is the trip's start time)
  const doneRecord = useMemo(() => (trip && isDone(trip) ? recordFrom(store, router, trip) : null), [trip, store, router]);
  const reset = useResetFlag(store.storeId);
  useEffect(() => {
    if (doneRecord && historyState.loaded && !historyState.history.some((h) => h.id === doneRecord.id)) {
      historyState.add(doneRecord);
      // the same once-per-trip moment decides whether the store looks reset
      const flag = trip ? detectReset(store, trip) : null;
      if (flag) reset.raise(flag);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneRecord?.id, historyState.loaded]);
  const [flat, setFlat] = useState<boolean>(() => load<boolean>(FLAT_KEY, false));
  // bumped when a survey re-derives the draft being edited: the editor remounts on the new draft
  const [editorEpoch, setEditorEpoch] = useState(0);
  useEffect(() => save(FLAT_KEY, flat), [flat]);
  const [paused, setPaused] = useState(false);

  const [settings, setSettings] = useState(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const provider = useMemo(() => providerFor(settings), [settings]);
  const res = useResolution(bundle, items, provider);
  useEffect(() => {
    if (restored.current || !res.catalogReady) return;
    restored.current = true;
    // never over a trip the shopper started while the catalog was still loading
    setTrip((current) => current ?? fromSnapshot(router, res.catalog, load<TripSnapshot | null>(TRIP_KEY, null)));
  }, [res.catalogReady, res.catalog, router]);
  useEffect(() => {
    // a trip in progress is always worth saving; a null before the restore would wipe the saved one
    if (trip || restored.current) save(TRIP_KEY, trip ? toSnapshot(trip) : null);
  }, [trip]);
  const stops = useMemo(() => res.results.map(toStop).filter((s): s is Stop => !!s), [res.results]);
  const notFound = useMemo(() => res.results.filter((r) => !r.locationIds.length).map((r) => r.query), [res.results]);
  const plan = useMemo(() => (stops.length ? router.solve({ stops }) : null), [stops, router]);
  const baselineM = useMemo(() => (stops.length ? router.routeForOrder(stops).distanceM : 0), [stops, router]);
  // the route's first stop in a hero zone: its close-up is prepared while the list is open
  usePrepareFirstStop(store, bundle.categories, plan?.legs.find((l) => l.stopId)?.locationId, !trip, Object.values(bundle.textures)[0]?.repeatMeters ?? 2);
  const [picking, setPicking] = useState<{ name: string; promote: boolean } | null>(null);
  const resultFor = (name: string) => res.results.find((r) => r.query === name);
  const picker = picking && (
    <PickerSheet
      store={store}
      itemName={picking.name}
      guessLocationId={resultFor(picking.name)?.locationIds[0] ?? null}
      onConfirm={(locationId) => {
        // the guess was right: a confirmation, not a correction
        const r = resultFor(picking.name);
        res.gotIt(r?.canonicalName ?? picking.name, locationId, r?.tags, picking.name);
        note(picking.name);
        setPicking(null);
      }}
      onPick={(locationId) => {
        const r = resultFor(picking.name);
        res.place(r?.canonicalName ?? picking.name, locationId, r?.tags, picking.promote, picking.name);
        note(picking.name);
        setPicking(null);
      }}
      onClose={() => setPicking(null)}
    />
  );

  // ?demo=walk: the off-list guard on a desk (lib/demoWalk.ts): load "Friday night in", start the trip once
  // every item is placed; the trip screen replays the walk
  const demo = useMemo(() => demoWalkOn(), []);
  const demoStage = useRef<"list" | "route" | "done">("list");
  useEffect(() => {
    if (!demo) return;
    const list = bundle.lists?.find((l) => l.name === DEMO_LIST);
    if (!list) return;
    if (demoStage.current === "list" && listsState.loaded) {
      demoStage.current = "route";
      setItems(list.items);
      return;
    }
    if (demoStage.current === "route" && !trip && res.catalogReady && items.length === list.items.length && stops.length + notFound.length >= list.items.length && !res.asking) {
      demoStage.current = "done";
      const t = window.setTimeout(() => setTrip(startTrip(router, stops, notFound)), 1200);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, listsState.loaded, res.catalogReady, stops.length, notFound.length, items.length, res.asking, trip]);

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

  // the error plate's own check (scripts/boot-resilience.mjs): a render error on purpose
  if (hash === "#/__crash") throw new Error("Crash test (#/__crash)");

  if (hash.startsWith("#/survey")) {
    return (
      <SurveyScreen
        bundle={WALMART_REFERENCE}
        onExit={() => {
          location.hash = "";
        }}
      />
    );
  }

  if (hash.startsWith("#/edit")) {
    // a surveyed store's draft, else the package (an unknown store id falls back to it)
    const sid = storeParam(hash);
    const edited = (sid && sid !== bundle.store.storeId && surveyedBundle(WALMART_REFERENCE, sid)) || bundle;
    return (
      <EditorScreen
        key={`${edited.store.storeId}:${editorEpoch}`}
        bundle={edited}
        onRebuilt={() => setEditorEpoch((n) => n + 1)}
        focus={parseEditorFocus(hash)}
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
            // a model guess checked off moves up its own ladder; it is not the shopper placing it ("yours")
            if (stop && leg?.locationId) res.gotIt(stop.name, leg.locationId, stop.tags, stop.query, stop.source === "llm");
            setTrip(gotIt(router, trip));
          }}
          onSkip={() => {
            const stop = trip.remaining.find((s) => s.id === trip.route.legs[0]?.stopId);
            if (stop) res.notHere(stop.name);
            setTrip(skipStop(router, trip));
          }}
          onAdd={(stop: Stop) => setTrip(addItem(router, trip, stop))}
          onBack={() => setPaused(true)}
          guardMode={settings.guard}
          demo={demo}
          onGuardCounts={(detours, offRouteMs) => setTrip((t) => (t ? { ...t, detours, offRouteMs } : t))}
          onTellWhere={(name) => setPicking({ name, promote: false })}
          onDemoGotIt={() => setTrip((t) => (t ? gotIt(router, t) : t))}
        />
        {picker}
      </>
    );
  }

  if (viewing) {
    return (
      <>
        <Ground />
        <CheckoutScreen
          store={store}
          router={router}
          record={viewing}
          previous={previousOf(historyState.history, viewing)}
          usualSaved={listsState.lists.some((l) => l.kind === "usual" && l.items.join("\n") === viewing.bought.join("\n"))}
          noted={noted}
          onNote={() => {}}
          onSaveUsual={() => listsState.saveUsual(viewing.bought, viewing.date)}
          onClose={() => setViewing(null)}
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
          previous={doneRecord ? previousOf(historyState.history, doneRecord) : undefined}
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
        onReplace={(from, to) => setItems((cur) => (cur.some((n) => n.toLowerCase() === to.toLowerCase()) ? cur.filter((n) => n !== from) : cur.map((n) => (n === from ? to : n))))}
        memory={res.memory}
        onLoadUsual={() => usualToday && listsState.loadList(usualToday.id)}
        onOpenLists={() => setListsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        reset={
          reset.visible && reset.flag
            ? {
                text: bannerText(store, reset.flag),
                onReview: () => {
                  location.hash = editorHashFor(reset.flag!);
                },
                onDismiss: reset.dismiss,
              }
            : null
        }
        onTellWhere={(name) => setPicking({ name, promote: false })}
        resume={trip && paused ? { remaining: trip.remaining.length, distanceM: trip.route.legs.reduce((s, l) => s + l.distanceM, 0) } : null}
        onRoute={() => {
          // the off-list guard reads the phone's motion; iOS asks for it, and only inside a tap
          if (settings.guard !== "off") void requestSensors();
          if (trip && paused) setPaused(false);
          else if (stops.length) setTrip(startTrip(router, stops, notFound));
        }}
      />
      {listsOpen && (
        <ListsSheet
          lists={listsState.lists}
          history={historyState.history}
          draftUnsaved={draftIsUnsaved(listsState.lists)}
          draftCount={items.length}
          onLoad={(id) => {
            listsState.loadList(id);
            setListsOpen(false);
          }}
          onDelete={listsState.deleteList}
          onRename={listsState.renameList}
          onSaveDraft={(name) => listsState.saveDraftAs(name)}
          onOpenRecord={(r) => {
            setListsOpen(false);
            setViewing(r);
          }}
          onClose={() => setListsOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsSheet
          settings={settings}
          onSave={(s) => {
            setSettings(saveSettings(s));
            setSettingsOpen(false);
          }}
          onReset={() => {
            setSettings(resetSettings());
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {picker}
    </>
  );
}
