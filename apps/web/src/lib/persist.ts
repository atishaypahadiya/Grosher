// Every value the app persists (localStorage through storage.ts, IndexedDB through db.ts) is stored in an
// envelope with its schema version: {__grosher: 1, v, data}. Reading one:
//
//   - a bare value (written before envelopes existed) is version 0 and goes through the migrations
//   - each key's migrations run from the stored version up to the current one
//   - the result must pass the key's validator
//   - anything that fails (corrupt JSON, a wrong shape, a version newer than this build) is quarantined:
//     kept as it was under a backup key, removed from its own key, and the reader gets its fallback
//
// So no stored value can crash the first render; at worst a feature starts empty and the old data is
// still on the device (grosher.quarantine.* in localStorage, quarantine:* in IndexedDB).

export const ENVELOPE = "__grosher";

export interface Envelope<T = unknown> {
  [ENVELOPE]: 1;
  v: number;
  data: T;
}

interface Schema {
  /** which keys this schema covers */
  match: (key: string) => boolean;
  /** the current version: what this build writes */
  version: number;
  /** migrations[n] takes version n to n + 1; may throw or return undefined to reject */
  migrations: ((data: unknown) => unknown)[];
  valid: (data: unknown) => boolean;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const strArr = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const optStrArr = (x: unknown) => x === undefined || strArr(x);
const arrOf = (x: unknown, ok: (e: unknown) => boolean) => Array.isArray(x) && x.every(ok);
/** keep the entries that pass; a list with a few bad rows is still the shopper's list */
const keep = (x: unknown, ok: (e: unknown) => boolean) => (Array.isArray(x) ? x.filter(ok) : undefined);

const listOk = (l: unknown) => isObj(l) && isStr(l.id) && isStr(l.name) && strArr(l.items) && (l.kind === "draft" || l.kind === "saved" || l.kind === "usual");
const recordOk = (r: unknown) => isObj(r) && isStr(r.id) && strArr(r.bought) && isNum(r.date);
const tripOk = (t: unknown) =>
  isObj(t) && strArr(t.original) && strArr(t.remaining) && strArr(t.got) && strArr(t.skipped) && isStr(t.positionNodeId) && isNum(t.walkedM) && optStrArr(t.visited) && optStrArr(t.doneNodeIds) && optStrArr(t.unplaced);

export const SCHEMAS: Schema[] = [
  {
    // per store (grosher.trip.<storeId>); the bare key is the demo Supercenter's from before Grosher
    match: (k) => k === "grosher.trip" || k.startsWith("grosher.trip."),
    version: 1,
    // v0: early snapshots lacked got / skipped
    migrations: [(t) => (isObj(t) ? { got: [], skipped: [], original: t.remaining, ...t } : t)],
    valid: (t) => t === null || tripOk(t),
  },
  { match: (k) => k === "grosher.notes" || k.startsWith("grosher.notes."), version: 1, migrations: [(x) => x], valid: strArr },
  { match: (k) => k.startsWith("grosher.offered."), version: 1, migrations: [(x) => x], valid: strArr },
  { match: (k) => k === "grosher.heroTier", version: 1, migrations: [(x) => x], valid: (x) => x === null || x === "lo" || x === "hi" },
  { match: (k) => k === "grosher.flat", version: 1, migrations: [(x) => x], valid: (x) => typeof x === "boolean" },
  // the settings sheet coerces each field onto the defaults itself (settings.ts sanitize)
  { match: (k) => k === "grosher.resolver", version: 1, migrations: [(x) => x], valid: isObj },
  {
    match: (k) => k.startsWith("grosher.reset."),
    version: 1,
    migrations: [(x) => x],
    valid: (x) => isObj(x) && (x.flag === null || x.flag === undefined || (isObj(x.flag) && isStr(x.flag.id) && isNum(x.flag.date) && strArr(x.flag.items) && isNum(x.flag.misses) && (x.flag.aisle === null || isStr(x.flag.aisle)))) && (x.dismissedId === null || x.dismissedId === undefined || isStr(x.dismissedId)),
  },
  {
    // an editor draft, and the draft a survey built (what that editor resets to)
    match: (k) => k.startsWith("grosher.editor.") || k.startsWith("grosher.surveydraft."),
    version: 1,
    migrations: [(x) => x],
    valid: (d) => isObj(d) && isObj(d.store) && Array.isArray(d.store.nodes) && Array.isArray(d.store.edges) && Array.isArray(d.store.locations) && Array.isArray(d.catalog),
  },
  { match: (k) => k.startsWith("lists:"), version: 1, migrations: [(x) => keep(x, listOk)], valid: (x) => arrOf(x, listOk) },
  { match: (k) => k.startsWith("history:"), version: 1, migrations: [(x) => keep(x, recordOk)], valid: (x) => arrOf(x, recordOk) },
  {
    match: (k) => k.startsWith("learning:"),
    version: 1,
    migrations: [(x) => (isObj(x) ? { pending: keep(x.pending, isObj) ?? [], llm: keep(x.llm, (e) => Array.isArray(e) && isStr(e[0])) ?? [], memory: keep(x.memory, (m) => isObj(m) && isStr(m.name) && isStr(m.locationId)) ?? [] } : undefined)],
    valid: (x) => isObj(x) && Array.isArray(x.pending) && Array.isArray(x.llm) && Array.isArray(x.memory),
  },
  // a derived catalog's rows under its key (catalogCache.ts); rows are not checked one by one (47,000 of them)
  { match: (k) => k.startsWith("catalog:"), version: 1, migrations: [(x) => x], valid: (x) => x === null || (isObj(x) && isStr(x.key) && Array.isArray(x.rows)) },
  { match: (k) => k.startsWith("index:"), version: 1, migrations: [(x) => x], valid: (x) => x === null || (isObj(x) && isStr(x.hash) && isObj(x.parts)) },
  { match: (k) => k === "grosher.calibration", version: 1, migrations: [(x) => x], valid: (x) => isObj(x) && isNum(x.paceMps) && isNum(x.distanceM) && (x.strideM === null || isNum(x.strideM)) },
  { match: (k) => k === "grosher.survey.active", version: 1, migrations: [(x) => x], valid: (x) => x === null || isStr(x) },
  { match: (k) => k.startsWith("survey:"), version: 1, migrations: [(x) => x], valid: (x) => x === null || (isObj(x) && x.format === "grosher.survey") },
  { match: (k) => k.startsWith("survey-photo:"), version: 1, migrations: [(x) => x], valid: (x) => x === null || isObj(x) },
];

/** anything not listed above: versioned all the same, any value but undefined passes */
const ANY: Schema = { match: () => true, version: 1, migrations: [(x) => x], valid: (x) => x !== undefined };

export const schemaFor = (key: string) => SCHEMAS.find((s) => s.match(key)) ?? ANY;

export const isEnvelope = (x: unknown): x is Envelope => isObj(x) && x[ENVELOPE] === 1 && isNum(x.v) && "data" in x;

export const wrap = <T>(key: string, data: T): Envelope<T> => ({ [ENVELOPE]: 1, v: schemaFor(key).version, data });

export type Read<T> = { ok: true; data: T; upgraded: boolean } | { ok: false; reason: string };

/** A stored value (already parsed) → its current-version data, or why it cannot be used. */
export function unwrap<T>(key: string, stored: unknown): Read<T> {
  const s = schemaFor(key);
  let v = 0;
  let data = stored;
  if (isEnvelope(stored)) {
    v = stored.v;
    data = stored.data;
  }
  if (v > s.version) return { ok: false, reason: `version ${v} is newer than this build's ${s.version}` };
  try {
    for (let n = v; n < s.version; n++) data = s.migrations[n](data);
  } catch (e) {
    return { ok: false, reason: `migration failed: ${e instanceof Error ? e.message : e}` };
  }
  if (!s.valid(data)) return { ok: false, reason: `not a valid ${key} (version ${v})` };
  return { ok: true, data: data as T, upgraded: v !== s.version };
}

export const QUARANTINE_LS = "grosher.quarantine.";
export const QUARANTINE_DB = "quarantine:";
/** backups kept per store; the oldest go first */
export const QUARANTINE_MAX = 8;

const warn = (key: string, reason: string) => console.warn(`[grosher] stored ${key} quarantined: ${reason}`);

/** localStorage: the raw string moves to grosher.quarantine.<key>.<time>; the key is removed. */
export function quarantineLocal(key: string, raw: string, reason: string): void {
  warn(key, reason);
  try {
    localStorage.setItem(`${QUARANTINE_LS}${key}.${Date.now()}`, raw);
    localStorage.removeItem(key);
    const backups = localKeys()
      .filter((k) => k.startsWith(QUARANTINE_LS))
      .sort((a, b) => Number(a.split(".").pop()) - Number(b.split(".").pop()));
    for (const k of backups.slice(0, Math.max(0, backups.length - QUARANTINE_MAX))) localStorage.removeItem(k);
  } catch {
    // full or blocked: at least drop the value that cannot be read
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }
}

export { warn as quarantineWarning };

/** localStorage's keys through the Storage API (not Object.keys, which a Storage shim may not enumerate) */
export function localKeys(): string[] {
  try {
    return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => k !== null);
  } catch {
    return [];
  }
}
