// Lists as data: the autosaving draft, saved lists and usual trips, per
// store in IndexedDB. Pure helpers here; useLists owns the state.

import { dbGet, dbSet } from "./db.ts";

export type ListKind = "draft" | "saved" | "usual";

export interface List {
  id: string;
  name: string;
  items: string[];
  storeId: string;
  createdAt: number;
  updatedAt: number;
  kind: ListKind;
  /** when the list was loaded onto the draft or walked as a trip; newest last, capped */
  usedAt?: number[];
}

const USED_CAP = 60;
export const key = (storeId: string) => `lists:${storeId}`;
export const uid = () => `l_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const loadLists = (storeId: string) => dbGet<List[]>(key(storeId), []);
export const saveLists = (storeId: string, lists: List[]) => dbSet(key(storeId), lists);

export function newList(storeId: string, kind: ListKind, name: string, items: string[], now = Date.now()): List {
  return { id: uid(), name, items: [...items], storeId, createdAt: now, updatedAt: now, kind, usedAt: [] };
}

export const draftOf = (lists: List[]) => lists.find((l) => l.kind === "draft");

/** The draft always exists; this returns the lists with one, creating it when missing. */
export function withDraft(lists: List[], storeId: string, now = Date.now()): List[] {
  return draftOf(lists) ? lists : [newList(storeId, "draft", "Draft", [], now), ...lists];
}

export function setDraftItems(lists: List[], items: string[], now = Date.now()): List[] {
  return lists.map((l) => (l.kind === "draft" ? { ...l, items: [...items], updatedAt: now } : l));
}

export function upsert(lists: List[], list: List): List[] {
  return lists.some((l) => l.id === list.id) ? lists.map((l) => (l.id === list.id ? list : l)) : [...lists, list];
}

export const remove = (lists: List[], id: string) => lists.filter((l) => l.id !== id);

export function rename(lists: List[], id: string, name: string, now = Date.now()): List[] {
  const n = name.trim();
  return n ? lists.map((l) => (l.id === id ? { ...l, name: n, updatedAt: now } : l)) : lists;
}

export function markUsed(lists: List[], id: string, now = Date.now()): List[] {
  return lists.map((l) => (l.id === id ? { ...l, usedAt: [...(l.usedAt ?? []), now].slice(-USED_CAP) } : l));
}

/** Loading a list onto the draft: the draft takes its items, the list counts as used. */
export function loadOntoDraft(lists: List[], id: string, now = Date.now()): List[] {
  const src = lists.find((l) => l.id === id);
  if (!src) return lists;
  return markUsed(setDraftItems(lists, src.items, now), id, now);
}

/** True when the draft holds items that match no saved or usual list exactly. */
export function draftIsUnsaved(lists: List[]): boolean {
  const d = draftOf(lists);
  if (!d || d.items.length === 0) return false;
  const sig = d.items.map((s) => s.trim().toLowerCase()).join("\n");
  return !lists.some((l) => l.kind !== "draft" && l.items.map((s) => s.trim().toLowerCase()).join("\n") === sig);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekdayName = (t: number) => WEEKDAYS[new Date(t).getDay()];

/**
 * "Save as usual trip": a usual list named after the trip's weekday. An
 * existing usual list of that name takes the new items; its history of use
 * is kept and today is added to it.
 */
export function saveUsualFromTrip(lists: List[], storeId: string, items: string[], when = Date.now()): { lists: List[]; list: List } {
  const name = `${weekdayName(when)} trip`;
  const existing = lists.find((l) => l.kind === "usual" && l.name === name);
  const list: List = existing
    ? { ...existing, items: [...items], updatedAt: when, usedAt: [...(existing.usedAt ?? []), when].slice(-USED_CAP) }
    : { ...newList(storeId, "usual", name, items, when), usedAt: [when] };
  return { lists: upsert(lists, list), list };
}

/**
 * The usual trip to offer today: the one used most often on this weekday;
 * with no usage on this weekday, the most recently used or updated one.
 */
export function predictUsual(lists: List[], now = Date.now()): List | undefined {
  const usual = lists.filter((l) => l.kind === "usual" && l.items.length > 0);
  if (!usual.length) return undefined;
  const dow = new Date(now).getDay();
  const score = (l: List) => (l.usedAt ?? []).filter((t) => new Date(t).getDay() === dow).length;
  const best = [...usual].sort((a, b) => score(b) - score(a))[0];
  if (score(best) > 0) return best;
  const last = (l: List) => Math.max(l.updatedAt, ...(l.usedAt ?? [0]));
  return [...usual].sort((a, b) => last(b) - last(a))[0];
}

/** Lists other than the draft, for export. */
export const exportable = (lists: List[]) => lists.filter((l) => l.kind !== "draft");

/** Merge imported lists: same id replaces, otherwise added; the draft is never imported. */
export function mergeImported(lists: List[], incoming: unknown): List[] {
  if (!Array.isArray(incoming)) return lists;
  let out = lists;
  for (const raw of incoming) {
    const l = raw as Partial<List>;
    if (!l || typeof l.id !== "string" || typeof l.name !== "string" || !Array.isArray(l.items) || l.kind === "draft") continue;
    const kind: ListKind = l.kind === "usual" ? "usual" : "saved";
    out = upsert(out, { id: l.id, name: l.name, items: l.items.filter((s): s is string => typeof s === "string"), storeId: l.storeId ?? "", createdAt: l.createdAt ?? Date.now(), updatedAt: l.updatedAt ?? Date.now(), kind, usedAt: Array.isArray(l.usedAt) ? l.usedAt.filter((t): t is number => typeof t === "number") : [] });
  }
  return out;
}
