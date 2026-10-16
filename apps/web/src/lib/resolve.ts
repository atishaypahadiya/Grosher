// Turn typed list lines into catalog Stops. Exact match on id or name first,
// then case-insensitive. Anything else is reported as not found.

import type { Stop } from "@grosher/core";

export interface Resolution {
  stops: Stop[];
  notFound: string[];
}

/** One item per line, trimmed, blank lines dropped, duplicates (case-insensitive) dropped. */
export function parseList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const key = line.toLowerCase();
    if (!line || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

export function resolveOne(name: string, catalog: Stop[]): Stop | undefined {
  const exact = catalog.find((s) => s.id === name || s.name === name);
  if (exact) return exact;
  const lower = name.trim().toLowerCase();
  return catalog.find((s) => s.id.toLowerCase() === lower || s.name.toLowerCase() === lower);
}

export function resolveItems(names: string[], catalog: Stop[]): Resolution {
  const stops: Stop[] = [];
  const notFound: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const s = resolveOne(name, catalog);
    if (!s) notFound.push(name);
    else if (!seen.has(s.id)) {
      seen.add(s.id);
      stops.push(s);
    }
  }
  return { stops, notFound };
}
