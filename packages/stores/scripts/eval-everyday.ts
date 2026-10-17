// Scores the blind everyday fixture on the demo Supercenter twice: offline
// (catalog + categories, no model) and with the local model answering for
// whatever is left unknown, exactly as the app does. Prints both tables.
//
//   npm run eval:everyday -w @grosher/stores
//   npm run eval:everyday -w @grosher/stores -- --catalog demo/catalog.instacart.json   # another catalog file (array, or {items})
//   npm run eval:everyday -w @grosher/stores -- --catalog a.json --catalog b.json      # several, merged in order (first wins a name)
//   npm run eval:everyday -w @grosher/stores -- --offline                             # skip the model
//
// Env: OLLAMA_URL (default http://localhost:11434), OLLAMA_MODEL (default qwen3:8b).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { llmMaxTokens, llmResultSchema, llmSystemPrompt, llmUserMessage, normalize, parseLlmResults, resolveList, type LlmGuess, type Stop } from "@grosher/core";
import { demoSupercenter, departmentLocations, llmOptions } from "../src/index.ts";
import { printEveryday, scoreEveryday } from "../../core/test/resolution-everyday.test.ts";

const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";
const BATCH = 25;

interface Case {
  q: string;
  aisle: string | string[];
  kind: string;
}

const { store, categories } = demoSupercenter;
const args = process.argv.slice(2);
const catalogPaths = args.flatMap((a, i) => (a === "--catalog" ? [args[i + 1]] : []));
const offline = args.includes("--offline");
const base = demoSupercenter.catalog; // the hand-kept rows are the synchronous catalog
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
const catalog = catalogPaths.length ? loadCatalogs(catalogPaths) : await demoSupercenter.loadCatalog();
const cases = (JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "core", "test", "fixtures", "resolution-everyday.json"), "utf8")) as { cases: Case[] }).cases;
const aisleOf = (id: string) => store.locations.find((l) => l.id === id)?.aisle;
const ctx = { catalog, categories, departments: store.departments, departmentLocations: departmentLocations(store), now: 2 };

const offlineResults = resolveList(
  cases.map((c) => c.q),
  ctx,
);
printEveryday(`everyday set, no model · catalog ${catalog.length} items (${catalogPaths.length ? catalogPaths.join(" + ") : "demo/catalog.json"}), ${categories.length} categories`, scoreEveryday(cases, offlineResults, aisleOf));
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
printEveryday(`everyday set, with ${MODEL} for the ${unknown.length} unknowns (${tokens} output tokens, ${Math.round(ms / 1000)} s)`, scoreEveryday(cases, withModel, aisleOf));
