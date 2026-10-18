// Per-row glyph for how an item was resolved. No emoji: small stroke icons.
import type { ResolveSource } from "@grosher/core";

const TITLES: Record<ResolveSource, string> = {
  exact: "In the catalog",
  fuzzy: "Close match",
  memory: "You found it here before",
  category: "The aisle sign says so",
  llm: "A guess from the model",
  unknown: "Needs a place",
};

export function SourceGlyph({ source }: { source: ResolveSource }) {
  const common = { className: "icon src-glyph", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, "data-source": source };
  const title = <title>{TITLES[source]}</title>;
  switch (source) {
    case "exact":
      return <svg {...common}>{title}<path d="M3 8.5l3 3 7-7" /></svg>;
    case "fuzzy":
      return <svg {...common}>{title}<path d="M2 9c2-3 4-3 6 0s4 3 6 0" /></svg>;
    case "memory":
      return <svg {...common}>{title}<circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></svg>;
    case "category":
      return <svg {...common}>{title}<rect x="2.5" y="4" width="11" height="6" rx="1" /><path d="M8 10v3.5" /></svg>;
    case "llm":
      return <svg {...common}>{title}<path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4z" /></svg>;
    default:
      return <svg {...common}>{title}<circle cx="8" cy="8" r="5.5" /><path d="M8 5.5v3M8 11h.01" /></svg>;
  }
}
