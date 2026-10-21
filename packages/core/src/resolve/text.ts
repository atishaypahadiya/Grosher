// Text normalisation for item resolution: case, punctuation, quantities,
// plurals; trigram and Damerau–Levenshtein similarity.

const QTY = /\b(\d+(?:[.,]\d+)?\s*(?:x\s*)?(?:pack|pk|ct|count|lb|lbs|oz|kg|g|l|ml|gal|gallon|litre|liter|dozen|pcs?|rolls?|bottles?|cans?|bunch(?:es)?)|packs? of \d+|\d+-pack|\d+pk|x\d+|large|small|medium|xl|family size|value pack)\b/g;

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "toilet paper 12 pack" → "toilet paper"; "milk 1 gallon" → "milk". */
export function stripQuantity(s: string): string {
  return normalize(normalize(s).replace(QTY, " ").replace(/\b\d+\b/g, " "));
}

export function singular(word: string): string {
  if (word.length <= 3) return word;
  if (/(ss|us|is)$/.test(word)) return word;
  if (/ies$/.test(word)) return word.slice(0, -3) + "y";
  if (/(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (/oes$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

export const singularize = (s: string) => s.split(" ").map(singular).join(" ");

/** All the comparable forms of a string, most specific first. */
export function forms(s: string): string[] {
  const n = normalize(s);
  const out = new Set<string>([n, singularize(n)]);
  const q = stripQuantity(s);
  if (q) {
    out.add(q);
    out.add(singularize(q));
  }
  return [...out].filter(Boolean);
}

/** padded trigram multiset; exported for the candidate index */
export function trigramCounts(s: string): Map<string, number> {
  return trigrams(s);
}

function trigrams(s: string): Map<string, number> {
  const t = new Map<string, number>();
  const padded = `  ${s} `;
  for (let i = 0; i + 3 <= padded.length; i++) {
    const g = padded.slice(i, i + 3);
    t.set(g, (t.get(g) ?? 0) + 1);
  }
  return t;
}

/** Dice coefficient over trigrams, 0..1. */
export function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  let na = 0;
  let nb = 0;
  for (const [g, c] of ta) {
    na += c;
    shared += Math.min(c, tb.get(g) ?? 0);
  }
  for (const c of tb.values()) nb += c;
  return (2 * shared) / (na + nb);
}

/** Optimal string alignment distance (Damerau–Levenshtein with adjacent transpositions). */
export function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

/** 0..1: the better of trigram Dice and 1 − DL / longer length. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const dl = 1 - damerauLevenshtein(a, b) / Math.max(a.length, b.length);
  return Math.max(trigramSimilarity(a, b), dl);
}
