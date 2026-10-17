// Seeds demo/catalog.json with products from the local Ollama model, one
// call per category: 25–40 common products a US Supercenter shopper would
// write on a list, each with a canonical name, 2–5 aliases (brands,
// abbreviations, plurals, Indian / English variants) and handling tags.
//
//   npm run seed:catalog -w @grosher/stores                 # all categories not yet seeded (resumable)
//   npm run seed:catalog -w @grosher/stores -- --only atta-flours,dal-lentils
//   npm run seed:catalog -w @grosher/stores -- --redo        # ignore progress, regenerate everything
//
// Strict JSON schema through Ollama's `format`, num_predict capped, three
// retries on bad JSON or a short answer, and the file is rewritten after
// every category so a stopped run resumes where it was. Items dedupe by
// canonical name; an item two categories both name keeps both locations.
// The hand-kept base rows (gen-demo.ts) keep their ids and come first.
//
// Env: OLLAMA_URL (default http://localhost:11434), OLLAMA_MODEL (default qwen3:8b).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Category, type ItemTag, type Stop } from "@grosher/core";
import { catalogKey, isBaseRow, reconcile } from "../src/reconcile.ts";

const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";
const MIN_ITEMS = 10; // asked for; a narrow category may honestly have fewer
const MAX_ITEMS = 25; // the model fills to the schema's maximum whatever the prompt says, so this is the real count
const MIN_ACCEPT = 6;
/** at most this many names per two-word stem ("english muffin …"): the rest fold into aliases */
const MAX_PER_STEM = 3;
const RETRIES = 3;
const NUM_PREDICT = 1800; // ~25 items × ~55 tokens with aliases, plus the envelope
const TIMEOUT_MS = 240_000;
const TAGS: ItemTag[] = ["frozen", "chilled", "heavy", "fragile", "produce"];

interface CatalogFile {
  generatedAt: string | null;
  model: string | null;
  seeded: string[];
  items: Stop[];
}

interface SeedItem {
  name: string;
  aliases: string[];
  tags: ItemTag[];
}

const demo = join(import.meta.dirname, "..", "demo");
const categories = JSON.parse(readFileSync(join(demo, "categories.json"), "utf8")) as Category[];
// the seed's own file; the shipped catalog.json is the merge (scripts/merge-catalogs.ts)
const catalogPath = join(demo, "catalog.seeded.json");
const baseRows = JSON.parse(readFileSync(join(demo, "catalog.base.json"), "utf8")) as Stop[];
const file: CatalogFile = existsSync(catalogPath) ? (JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogFile) : { generatedAt: null, model: null, seeded: [], items: [...baseRows] };
if (!file.items.some((s) => isBaseRow(s))) file.items.unshift(...baseRows);

const args = process.argv.slice(2);
const only = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",")) : null;
const redo = args.includes("--redo");

const SYSTEM = `You list the products a US Walmart Supercenter actually stocks on the shelves of one category, the way a shopper writes them on a grocery list.
Reply with JSON only: {"items":[{"name":"<canonical name, 1-4 words, lowercase except brands, no sizes>","aliases":["<2-5 other ways people write it: brand names, abbreviations, plural or singular, Indian or Spanish names>"],"tags":[]}]}.
${MIN_ITEMS} to ${MAX_ITEMS} distinct products, but only products physically shelved in this category: when the category is narrow, stop early rather than pad it with dishes, recipes or products from other aisles (bananas are not banana bread).
One entry per product, not per flavour or variety: "english muffins" once, with flavours as aliases, never "english muffin plain", "english muffin cinnamon", "peanut butter cups with sprinkles".
No duplicates, no sizes or counts in names, name the product not the brand unless the brand is what people say (Oreos, Nutella).
tags, usually empty: frozen (freezer case), chilled (fridge), heavy (over 3 kg or a case of liquid), fragile (eggs, chips, glass), produce (fresh fruit or veg).`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      minItems: MIN_ACCEPT,
      maxItems: MAX_ITEMS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "aliases", "tags"],
        properties: {
          name: { type: "string", minLength: 2, maxLength: 48 },
          aliases: { type: "array", minItems: 2, maxItems: 5, items: { type: "string", minLength: 1, maxLength: 40 } },
          tags: { type: "array", maxItems: 3, items: { type: "string", enum: TAGS } },
        },
      },
    },
  },
};

const prompt = (c: Category) =>
  `Category: "${c.name}" (aisle sign "${c.group}", department ${c.department}).\nKnown names for this category: ${(c.aliases ?? []).join(", ") || "none"}.\nList the products.`;

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
const norm = catalogKey;

async function ask(c: Category, attempt: number): Promise<SeedItem[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        think: false,
        keep_alive: "24h",
        format: schema,
        options: { temperature: 0.3 + 0.2 * attempt, num_predict: NUM_PREDICT, seed: 11 + attempt },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt(c) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const body = (await res.json()) as { message?: { content?: string }; eval_count?: number; eval_duration?: number; done_reason?: string };
    const content = body.message?.content ?? "";
    const parsed = JSON.parse(content) as { items?: unknown };
    if (!Array.isArray(parsed.items)) throw new Error("no items array");
    const items = (parsed.items as Partial<SeedItem>[])
      .filter((it) => typeof it.name === "string" && it.name.trim().length >= 2)
      .map((it) => ({
        name: it.name!.trim().replace(/\s+/g, " "),
        aliases: (Array.isArray(it.aliases) ? it.aliases : []).filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim().replace(/\s+/g, " ")),
        tags: (Array.isArray(it.tags) ? it.tags : []).filter((t): t is ItemTag => TAGS.includes(t as ItemTag)),
      }));
    if (items.length < MIN_ACCEPT) throw new Error(`only ${items.length} items (${body.done_reason ?? "?"})`);
    const tok = body.eval_count ?? 0;
    const ms = Math.round((body.eval_duration ?? 0) / 1e6);
    console.log(`  ${items.length} items · ${tok} tok / ${ms} ms`);
    return items;
  } finally {
    clearTimeout(timer);
  }
}

/** fold flavour padding: when more than MAX_PER_STEM names share their first two words, keep the shortest and turn the rest into aliases of it */
function foldVariants(seed: SeedItem[]): SeedItem[] {
  const stem = (name: string) => norm(name).split(" ").slice(0, 2).join(" ");
  const groups = new Map<string, SeedItem[]>();
  for (const it of seed) {
    const k = stem(it.name);
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const out: SeedItem[] = [];
  // "crouton with sage" is a flavour, not a product
  for (const [k, g] of groups) groups.set(k, g.filter((it) => !/\bwith\b/i.test(it.name)));
  for (const group of groups.values()) {
    if (group.length <= MAX_PER_STEM) {
      out.push(...group);
      continue;
    }
    const sorted = [...group].sort((a, b) => a.name.length - b.name.length);
    const keep = sorted.slice(0, MAX_PER_STEM);
    const rest = sorted.slice(MAX_PER_STEM);
    keep[0] = { ...keep[0], aliases: [...keep[0].aliases, ...rest.map((r) => r.name)] };
    out.push(...keep);
  }
  return out;
}

/** merge a category's products into the catalog: by normalised name, keeping both locations when two categories name the same item */
function mergeInto(items: Stop[], c: Category, seedRaw: SeedItem[]): { added: number; merged: number } {
  const seed = foldVariants(seedRaw);
  const byName = new Map(items.map((s) => [norm(s.name), s]));
  const ids = new Set(items.map((s) => s.id));
  let added = 0;
  let merged = 0;
  for (const it of seed) {
    const key = norm(it.name);
    if (!key) continue;
    const existing = byName.get(key);
    const aliases = [...new Set(it.aliases.map((a) => a.trim()).filter((a) => a && norm(a) !== key))];
    const tags = [...new Set([...(it.tags ?? []), ...(c.tags ?? [])])];
    if (existing && isBaseRow(existing)) {
      merged++; // a hand-kept base row is authoritative: the seeded duplicate is dropped
      continue;
    }
    if (existing) {
      if (!existing.locationIds.includes(c.locationId)) existing.locationIds.push(c.locationId);
      existing.aliases = [...new Set([...(existing.aliases ?? []), ...aliases])];
      if (tags.length) existing.tags = [...new Set([...(existing.tags ?? []), ...tags])];
      merged++;
      continue;
    }
    let id = slug(it.name) || `item-${items.length}`;
    while (ids.has(id)) id = `${id}-2`;
    ids.add(id);
    const stop: Stop = { id, name: it.name.charAt(0).toUpperCase() + it.name.slice(1), locationIds: [c.locationId] };
    if (aliases.length) stop.aliases = aliases;
    if (tags.length) stop.tags = tags as ItemTag[];
    (stop as Stop & { category?: string }).category = c.id;
    items.push(stop);
    byName.set(key, stop);
    added++;
  }
  return { added, merged };
}

/** drop a category's generated rows before regenerating it */
function dropCategory(items: Stop[], c: Category, baseIds: Set<string>): Stop[] {
  return items.filter((s) => baseIds.has(s.id) || (s as Stop & { category?: string }).category !== c.id);
}

if (args.includes("--reconcile")) {
  // --file <path> reconciles another catalog file in place (the import, a merge); default demo/catalog.json
  const target = args.includes("--file") ? join(process.cwd(), args[args.indexOf("--file") + 1]) : catalogPath;
  const doc = target === catalogPath ? file : (JSON.parse(readFileSync(target, "utf8")) as { items: Stop[] });
  const r = reconcile(doc.items, categories);
  writeFileSync(target, JSON.stringify(doc, null, target === catalogPath ? 2 : 1) + "\n");
  console.log(`reconciled ${doc.items.length} items in ${target.split("/").slice(-2).join("/")}: ${r.relocated} relocated, ${r.locationsDropped} locations dropped, ${r.aliasesDropped} aliases dropped`);
  process.exit(0);
}

const baseIds = new Set(file.items.filter(isBaseRow).map((s) => s.id));
const seeded = new Set(redo ? [] : file.seeded);
const todo = categories.filter((c) => (only ? only.has(c.id) : !seeded.has(c.id)));
console.log(`${todo.length} of ${categories.length} categories to seed with ${MODEL} at ${OLLAMA_URL}; ${file.items.length} items on file`);

let items = file.items;
const t0 = Date.now();
for (const [i, c] of todo.entries()) {
  console.log(`[${i + 1}/${todo.length}] ${c.id} (${c.aisle} · ${c.name})`);
  let seed: SeedItem[] | null = null;
  for (let attempt = 0; attempt < RETRIES && !seed; attempt++) {
    try {
      seed = await ask(c, attempt);
    } catch (e) {
      console.log(`  retry ${attempt + 1}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (!seed) {
    console.log(`  giving up on ${c.id}`);
    continue;
  }
  items = dropCategory(items, c, baseIds);
  const { added, merged } = mergeInto(items, c, seed);
  seeded.add(c.id);
  const out: CatalogFile = { generatedAt: new Date().toISOString().slice(0, 10), model: MODEL, seeded: [...seeded], items };
  writeFileSync(catalogPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`  +${added} new, ${merged} merged → ${items.length} items · ${Math.round((Date.now() - t0) / 1000)} s elapsed`);
}
const r = reconcile(items, categories);
writeFileSync(catalogPath, JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), model: MODEL, seeded: [...seeded], items } satisfies CatalogFile, null, 2) + "\n");
console.log(`reconciled: ${r.relocated} relocated, ${r.locationsDropped} locations dropped, ${r.aliasesDropped} aliases dropped`);
console.log(`done: ${items.length} items, ${seeded.size}/${categories.length} categories seeded`);
