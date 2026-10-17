// Lists state for one store: the autosaving draft plus saved and usual lists.

import { useCallback, useEffect, useState } from "react";
import { load as loadLocal, save as saveLocal } from "./storage.ts";
import { draftOf, loadLists, loadOntoDraft, markUsed, newList, remove, rename, saveLists, saveUsualFromTrip, setDraftItems, upsert, withDraft, type List } from "./lists.ts";

const OLD_ITEMS_KEY = "grosher.items";
const OLD_USUAL_KEY = "grosher.usual";

export interface ListsState {
  lists: List[];
  draft: List | undefined;
  items: string[];
  loaded: boolean;
  setItems: (items: string[] | ((cur: string[]) => string[])) => void;
  saveDraftAs: (name: string) => List | undefined;
  loadList: (id: string) => void;
  deleteList: (id: string) => void;
  renameList: (id: string, name: string) => void;
  saveUsual: (items: string[], when?: number) => List;
  touchUsed: (id: string) => void;
  importLists: (lists: List[]) => void;
}

export function useLists(storeId: string): ListsState {
  const [lists, setLists] = useState<List[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    setLoaded(false);
    loadLists(storeId).then((stored) => {
      if (!live) return;
      let next = withDraft(stored, storeId);
      // one-time migration from the localStorage era
      const oldItems = loadLocal<string[] | null>(OLD_ITEMS_KEY, null);
      const oldUsual = loadLocal<string[] | null>(OLD_USUAL_KEY, null);
      if (oldItems?.length && draftOf(next)!.items.length === 0) next = setDraftItems(next, oldItems);
      if (oldUsual?.length && !next.some((l) => l.kind === "usual")) next = upsert(next, newList(storeId, "usual", "Usual trip", oldUsual));
      saveLocal(OLD_ITEMS_KEY, null);
      saveLocal(OLD_USUAL_KEY, null);
      // items typed before the store answered stay on the draft
      setLists((cur) => {
        const typed = draftOf(cur)?.items ?? [];
        return typed.length ? setDraftItems(next, typed) : next;
      });
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [storeId]);
  useEffect(() => {
    if (loaded) void saveLists(storeId, lists);
  }, [lists, loaded, storeId]);

  const draft = draftOf(lists);
  const items = draft?.items ?? [];
  const setItems = useCallback<ListsState["setItems"]>((next) => setLists((cur) => setDraftItems(withDraft(cur, storeId), typeof next === "function" ? next(draftOf(cur)?.items ?? []) : next)), [storeId]);
  const saveDraftAs = useCallback(
    (name: string) => {
      const d = draftOf(lists);
      if (!d || !d.items.length || !name.trim()) return undefined;
      const l = newList(storeId, "saved", name.trim(), d.items);
      setLists((cur) => markUsed(upsert(cur, l), l.id));
      return l;
    },
    [lists, storeId],
  );
  const loadList = useCallback((id: string) => setLists((cur) => loadOntoDraft(cur, id)), []);
  const deleteList = useCallback((id: string) => setLists((cur) => remove(cur, id)), []);
  const renameList = useCallback((id: string, name: string) => setLists((cur) => rename(cur, id, name)), []);
  const saveUsual = useCallback(
    (its: string[], when = Date.now()) => {
      const r = saveUsualFromTrip(lists, storeId, its, when);
      setLists((cur) => saveUsualFromTrip(cur, storeId, its, when).lists);
      return r.list;
    },
    [lists, storeId],
  );
  const touchUsed = useCallback((id: string) => setLists((cur) => markUsed(cur, id)), []);
  const importLists = useCallback((incoming: List[]) => setLists((cur) => incoming.reduce((acc, l) => upsert(acc, l), cur)), []);

  return { lists, draft, items, loaded, setItems, saveDraftAs, loadList, deleteList, renameList, saveUsual, touchUsed, importLists };
}
