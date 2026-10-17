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

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Category, ItemTag, Stop } from "@grosher/core";

const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";
const MIN_ITEMS = 25;
const MAX_ITEMS = 40;
const RETRIES = 3;
const NUM_PREDICT = 2400; // ~40 items × ~50 tokens with aliases, plus the envelope
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
const catalogPath = join(demo, "catalog.json");
const file = JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogFile;

const args = process.argv.slice(2);
const only = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",")) : null;
const redo = args.includes("--redo");

const SYSTEM = `You list the products a US Walmart Supercenter stocks in one shelf category, the way a shopper writes them on a grocery list.
Reply with JSON only: {"items":[{"name":"<canonical name, 1-4 words, lowercase except brands, no sizes>","aliases":["<2-5 other ways people write it: brand names, abbreviations, plural or singular, Indian or Spanish names>"],"tags":[]}]}.
Give ${MIN_ITEMS} to ${MAX_ITEMS} distinct, common products. No duplicates, no sizes or counts in names, no products that belong to another category.
tags, usually empty: frozen (freezer case), chilled (fridge), heavy (over 3 kg or a case of liquid), fragile (eggs, chips, glass), produce (fresh fruit or veg).`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      minItems: MIN_ITEMS,
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
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();

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
    if (items.length < Math.floor(MIN_ITEMS * 0.6)) throw new Error(`only ${items.length} items (${body.done_reason ?? "?"})`);
    const tok = body.eval_count ?? 0;
    const ms = Math.round((body.eval_duration ?? 0) / 1e6);
    console.log(`  ${items.length} items · ${tok} tok / ${ms} ms`);
    return items;
  } finally {
    clearTimeout(timer);
  }
}

/** merge a category's products into the catalog: by normalised name, keeping both locations when two categories name the same item */
function mergeInto(items: Stop[], c: Category, seed: SeedItem[]): { added: number; merged: number } {
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

const baseIds = new Set(file.items.filter((s) => !(s as Stop & { category?: string }).category).map((s) => s.id));
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
console.log(`done: ${items.length} items, ${seeded.size}/${categories.length} categories seeded`);
