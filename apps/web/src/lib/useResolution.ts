// Resolution state for the List screen and the learning loop: the merged
// catalog (package + pending), the shopper's memory, the llm cache; a
// debounced resolve on every change; a debounced fetch of unknowns from the
// resolver worker that writes pending entries so they resolve offline next
// time; and the learning updates the trip and checkout screens call.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirmMemory, confirmed, demoteMemory, missed, normalize, pendingEntry, placeMemory, resolveList, type ItemMemory, type ItemTag, type LlmGuess, type ResolveResult, type Stop } from "@grosher/core";
import { departmentLocations, type StoreBundle } from "@grosher/stores";
import { defaultProvider, fetchGuesses, type LlmProvider } from "./resolver.ts";
import { EMPTY_LEARNING, loadLearning, mergedCatalog, saveLearning, type Learning } from "./learning.ts";

export const RESOLVE_DEBOUNCE_MS = 150;
/** the LLM batch waits for the list to go idle; never per keystroke */
export const LLM_DEBOUNCE_MS = 1500;

export interface ResolutionState {
  results: ResolveResult[];
  catalog: Stop[]; // merged
  memory: ItemMemory[];
  loaded: boolean;
  asking: boolean; // an llm request is in flight
  warming: boolean; // the local model was not loaded when the request started
  offline: boolean; // the last llm request failed
  /** the provider's one-line note for the header when offline */
  offlineNote: string;
  gotIt: (name: string, locationId: string, tags?: ItemTag[], typed?: string) => void;
  notHere: (name: string) => void;
  /** `name` is the canonical name, `typed` what the shopper wrote */
  place: (name: string, locationId: string, tags?: ItemTag[], promote?: boolean, typed?: string) => void;
  learning: Learning;
}

export function useResolution(bundle: StoreBundle, items: string[], provider?: LlmProvider): ResolutionState {
  const { store, catalog } = bundle;
  const llmProvider = useMemo(() => provider ?? defaultProvider(), [provider]);
  // warm the local model once per mount so the first real call fits the timeout
  useEffect(() => {
    void llmProvider.warmUp?.();
  }, [llmProvider]);
  const storeId = store.storeId;
  const [learning, setLearning] = useState<Learning>(EMPTY_LEARNING);
  const [loaded, setLoaded] = useState(false);
  const [asking, setAsking] = useState(false);
  const [warming, setWarming] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let live = true;
    setLoaded(false);
    loadLearning(storeId).then((l) => {
      if (!live) return;
      setLearning(l);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [storeId]);
  useEffect(() => {
    if (loaded) void saveLearning(storeId, learning);
  }, [learning, loaded, storeId]);

  const merged = useMemo(() => mergedCatalog(catalog, learning.pending), [catalog, learning.pending]);
  const deptLocs = useMemo(() => departmentLocations(store), [store]);
  const llmMap = useMemo(() => new Map<string, LlmGuess | null>(learning.llm), [learning.llm]);

  // debounced resolve
  const [results, setResults] = useState<ResolveResult[]>([]);
  const itemsKey = items.join("\n");
  useEffect(() => {
    const run = () => setResults(resolveList(items, { catalog: merged, departments: store.departments, departmentLocations: deptLocs, memory: learning.memory, llm: llmMap }));
    const id = setTimeout(run, RESOLVE_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, merged, learning.memory, llmMap, deptLocs, store.departments]);

  // debounced llm fetch for unknowns that were never asked
  const inFlight = useRef(new Set<string>());
  useEffect(() => {
    if (!loaded) return;
    const unknown = results.filter((r) => r.source === "unknown" && !llmMap.has(normalize(r.query)) && !inFlight.current.has(normalize(r.query))).map((r) => r.query);
    if (!unknown.length) return;
    const id = setTimeout(async () => {
      const keys = unknown.map(normalize);
      keys.forEach((k) => inFlight.current.add(k));
      setAsking(true);
      try {
        const loadedNow = (await llmProvider.isLoaded?.()) ?? true;
        setWarming(!loadedNow);
        const guesses = await fetchGuesses(unknown, (store.departments ?? []).map((d) => d.id), llmProvider, { coldStart: !loadedNow });
        setOffline(false);
        setLearning((l) => {
          const llm = new Map(l.llm);
          for (const k of keys) llm.set(k, guesses.get(k) ?? null);
          const ctx = { catalog: mergedCatalog(catalog, l.pending), departments: store.departments, departmentLocations: deptLocs, memory: l.memory, llm };
          const pending = [...l.pending];
          for (const r of resolveList(unknown, ctx)) {
            const p = pendingEntry(r);
            if (p && !pending.some((x) => x.id === p.id)) pending.push(p);
          }
          return { ...l, llm: [...llm], pending };
        });
      } catch {
        setOffline(true);
      } finally {
        keys.forEach((k) => inFlight.current.delete(k));
        setAsking(false);
        setWarming(false);
      }
    }, LLM_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, loaded]);

  // pending catalog entries (llm guesses, promoted placements) follow the same confidence rules as memory
  const touchPending = (pending: Stop[], name: string, fn: (p: Stop) => Stop) => {
    const key = normalize(name);
    return pending.map((p) => (normalize(p.name) === key ? fn(p) : p));
  };
  const gotIt = useCallback((name: string, locationId: string, tags?: ItemTag[], typed?: string) => {
    const now = Date.now();
    setLearning((l) => ({ ...l, memory: confirmMemory(l.memory, name, locationId, now, tags, typed), pending: touchPending(l.pending, name, (p) => confirmed(p, now)) }));
  }, []);
  const notHere = useCallback((name: string) => {
    const now = Date.now();
    setLearning((l) => ({ ...l, memory: demoteMemory(l.memory, name, now), pending: touchPending(l.pending, name, (p) => missed(p, now)) }));
  }, []);
  const place = useCallback(
    (name: string, locationId: string, tags?: ItemTag[], promote = false, typed?: string) =>
      setLearning((l) => {
        const memory = placeMemory(l.memory, name, locationId, Date.now(), tags, typed);
        if (!promote) return { ...l, memory };
        const id = `mem:${normalize(name).replace(/\s+/g, "-")}`;
        const entry: Stop = { id, name, aliases: [...new Set([name, ...(typed ? [typed] : [])])], locationIds: [locationId], tags, confidence: 0.9, source: "memory" };
        const pending = [...l.pending.filter((p) => p.id !== id && normalize(p.name) !== normalize(name)), entry];
        return { ...l, memory, pending };
      }),
    [],
  );

  return { results, catalog: merged, memory: learning.memory, loaded, asking, warming, offline, offlineNote: llmProvider.offlineNote, gotIt, notHere, place, learning };
}
