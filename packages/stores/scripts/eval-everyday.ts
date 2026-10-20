// Scores the blind everyday fixture on the demo Supercenter twice: offline
// (catalog + categories, no model) and with the local model answering for
// whatever is left unknown, exactly as the app does. Prints both tables.
//
// --store grosher scores the same fixture on Grosher. The fixture names the demo's aisles, so each expected
// aisle becomes the Grosher aisles that hold that aisle's categories (the demo's A7 "Asian · Indian" is
// Grosher's A2 for atta and spices, A3 for basmati, A4 for the rest). It also scores test/fixtures/
// grosher-new-shelves.json (things Walmart grocery had no shelf for) at category level on both stores.
//
//   npm run eval:everyday -w @grosher/stores
//   npm run eval:everyday -w @grosher/stores -- --catalog demo/catalog.instacart.json   # another catalog file (array, or {items})
//   npm run eval:everyday -w @grosher/stores -- --catalog a.json --catalog b.json      # several, merged in order (first wins a name)
//   npm run eval:everyday -w @grosher/stores -- --offline                             # skip the model
//   npm run eval:everyday -w @grosher/stores -- --store grosher                       # Grosher, plus the new-shelves set
//   ... --json <path>   also writes the offline scores (apps/web/scripts/docs-numbers.mjs checks the docs against them)
//
// Env: OLLAMA_URL (default http://localhost:11434), OLLAMA_MODEL (default qwen3:8b).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { llmMaxTokens, llmResultSchema, llmSystemPrompt, llmUserMessage, normalize, parseLlmResults, resolveList, type LlmGuess, type Stop } from "@grosher/core";
import { demoSupercenter, departmentLocations, grosher, llmOptions } from "../src/index.ts";
import { printEveryday, scoreEveryday } from "../../core/test/resolution-everyday.test.ts";

const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";
const BATCH = 25;

interface Case {
  q: string;
  aisle: string | string[];
  kind: string;
}

const args = process.argv.slice(2);
const bundle = args[args.indexOf("--store") + 1] === "grosher" && args.includes("--store") ? grosher : demoSupercenter;
const { store, categories } = bundle;
const catalogPaths = args.flatMap((a, i) => (a === "--catalog" ? [args[i + 1]] : []));
const offline = args.includes("--offline");
const base = bundle.catalog; // the hand-kept rows are the synchronous catalog
/** several catalogs merge in order: the first to claim a normalised name wins; the hand-kept base rows always come first */
function loadCatalogs(paths: string[]): Stop[] {
  const out: Stop[] = [...base];
  const seen = new Set(out.map((s) => normalize(s.name)));
  for (const p of paths) {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Stop[] | { items: Stop[] };
    for (const s of Array.isArray(raw) ? raw : raw.items) {
      const k = normalize(s.name);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}
const catalog = catalogPaths.length ? loadCatalogs(catalogPaths) : await bundle.loadCatalog();
const demoCases = (JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "core", "test", "fixtures", "resolution-everyday.json"), "utf8")) as { cases: Case[] }).cases;
/** a demo aisle → the aisles of this store that hold its categories */
const translate = (aisle: string) => {
  const ids = new Set(demoSupercenter.categories.filter((c) => c.aisle === aisle).map((c) => c.id));
  const here = [...new Set(categories.filter((c) => ids.has(c.id)).map((c) => c.aisle))];
  return here.length ? here : [aisle];
};
const cases = bundle === demoSupercenter ? demoCases : demoCases.map((c) => ({ ...c, aisle: [...new Set((Array.isArray(c.aisle) ? c.aisle : [c.aisle]).flatMap(translate))] }));
const aisleOf = (id: string) => store.locations.find((l) => l.id === id)?.aisle;
const ctx = { catalog, categories, departments: store.departments, departmentLocations: departmentLocations(store), now: 2 };

const offlineResults = resolveList(
  cases.map((c) => c.q),
  ctx,
);
const offlineReport = scoreEveryday(cases, offlineResults, aisleOf);
printEveryday(`everyday set on ${store.name}, no model · catalog ${catalog.length} items (${catalogPaths.length ? catalogPaths.join(" + ") : "its full catalog"}), ${categories.length} categories`, offlineReport);
const json: { store: string; everyday: { correct: number; total: number; byKind: Record<string, { total: number; correct: number }> }; newShelves: Record<string, number> } = {
  store: store.storeId,
  everyday: { correct: offlineReport.correct, total: offlineReport.total, byKind: offlineReport.byKind },
  newShelves: {},
};

// things Walmart grocery had no shelf for, at category level, on this store and on the demo
interface NewCase {
  q: string;
  category: string | string[] | null;
}
const newCases = (JSON.parse(readFileSync(join(import.meta.dirname, "..", "test", "fixtures", "grosher-new-shelves.json"), "utf8")) as { cases: NewCase[] }).cases;
async function newShelves(b: typeof bundle, llm?: Map<string, LlmGuess | null>) {
  const cat = await b.loadCatalog();
  const catOf = new Map(b.categories.map((c) => [c.locationId, c.id]));
  const rs = resolveList(
    newCases.map((c) => c.q),
    { catalog: cat, categories: b.categories, departments: b.store.departments, departmentLocations: departmentLocations(b.store), now: 2, llm },
  );
  let ok = 0;
  const rows = newCases.map((c, i) => {
    const got = rs[i].locationIds.length ? catOf.get(rs[i].locationIds[0]) ?? "?" : null;
    const want = c.category === null ? [null] : Array.isArray(c.category) ? c.category : [c.category];
    const hit = want.includes(got as never);
    if (hit) ok++;
    return `  ${hit ? "ok  " : "miss"}  ${c.q.padEnd(18)} → ${(got ?? "Needs a place").padEnd(22)} via ${rs[i].source}${rs[i].canonicalName ? ` "${rs[i].canonicalName}"` : ""}`;
  });
  if (!llm) json.newShelves[b.store.storeId] = ok;
  console.log(`\nnew shelves on ${b.store.name}${llm ? " (with the model)" : ", no model"}: ${ok} of ${newCases.length} where Grosher sells them`);
  console.log(rows.join("\n"));
  return rs;
}
if (bundle === grosher) {
  await newShelves(demoSupercenter);
  await newShelves(grosher);
}
const jsonAt = args.indexOf("--json");
if (jsonAt >= 0) writeFileSync(args[jsonAt + 1], JSON.stringify(json, null, 2) + "\n");
if (offline) process.exit(0);

// the unknowns go to the model in batches, as the app would send them
const unknown = cases.filter((_, i) => offlineResults[i].source === "unknown").map((c) => c.q);
console.log(`${unknown.length} unknown → ${MODEL}`);
const options = llmOptions(categories);
const ids = options.map((o) => o.id);
const llm = new Map<string, LlmGuess | null>();
let tokens = 0;
let ms = 0;
for (let i = 0; i < unknown.length; i += BATCH) {
  const items = unknown.slice(i, i + BATCH);
  const t0 = performance.now();
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: false,
      keep_alive: "24h",
      format: llmResultSchema(ids),
      options: { temperature: 0, num_predict: llmMaxTokens(items.length) },
      messages: [
        { role: "system", content: llmSystemPrompt(options) },
        { role: "user", content: llmUserMessage(items) },
      ],
    }),
  });
  const body = (await res.json()) as { message?: { content?: string }; eval_count?: number; prompt_eval_count?: number };
  const rows = parseLlmResults(JSON.parse(body.message?.content ?? "{}"), items, ids);
  for (const r of rows) llm.set(normalize(r.item), r.category ? { category: r.category, subcategory: r.subcategory, canonicalName: r.canonicalName, tags: r.tags, confidence: r.confidence } : null);
  tokens += body.eval_count ?? 0;
  ms += performance.now() - t0;
  console.log(`  batch ${i / BATCH + 1}: ${items.length} items · prompt ${body.prompt_eval_count ?? "?"} tok · gen ${body.eval_count ?? "?"} tok · ${Math.round(performance.now() - t0)} ms`);
}
const withModel = resolveList(
  cases.map((c) => c.q),
  { ...ctx, llm },
);
printEveryday(`everyday set on ${store.name}, with ${MODEL} for the ${unknown.length} unknowns (${tokens} output tokens, ${Math.round(ms / 1000)} s)`, scoreEveryday(cases, withModel, aisleOf));

// the new-shelves set with the model answering its unknowns, on both stores
if (bundle === grosher) {
  for (const b of [demoSupercenter, grosher]) {
    const opts = llmOptions(b.categories);
    const offlineNew = await (async () => {
      const cat = await b.loadCatalog();
      return resolveList(newCases.map((c) => c.q), { catalog: cat, categories: b.categories, now: 2 });
    })();
    const items = newCases.filter((_, i) => offlineNew[i].source === "unknown").map((c) => c.q);
    const m = new Map<string, LlmGuess | null>();
    if (items.length) {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, stream: false, think: false, keep_alive: "24h", format: llmResultSchema(opts.map((o) => o.id)), options: { temperature: 0, num_predict: llmMaxTokens(items.length) }, messages: [{ role: "system", content: llmSystemPrompt(opts) }, { role: "user", content: llmUserMessage(items) }] }),
      });
      const body = (await res.json()) as { message?: { content?: string } };
      for (const r of parseLlmResults(JSON.parse(body.message?.content ?? "{}"), items, opts.map((o) => o.id))) m.set(normalize(r.item), r.category ? { category: r.category, subcategory: r.subcategory, canonicalName: r.canonicalName, tags: r.tags, confidence: r.confidence } : null);
    }
    await newShelves(b, m);
  }
}
