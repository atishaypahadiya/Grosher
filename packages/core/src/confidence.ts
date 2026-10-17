// The confidence model every catalog entry and memory row follows. Pure:
// records in, records out, `now` passed in.
//
//   "Got it"    confidence moves toward 1 by 30% of the gap, confirms+1, lastConfirmed = now
//   "Not here"  confidence −0.3 (floor 0.05), misses+1, lastMissed = now
//   decay       not confirmed for 90 days → −0.1 per further 30 days, floor 0.4;
//               applied lazily on read (`decayed`), never stored
//   bands       ≥ 0.8 confirmed · 0.5–0.8 likely · < 0.5 guess
//
// An entry that was never confirmed (a surveyed package entry, a fresh llm
// guess) has no lastConfirmed and does not decay: there is no date to count
// from, and the bands already say what it is.

export interface ConfidenceRecord {
  /** 0..1 */
  confidence?: number;
  confirms?: number;
  misses?: number;
  /** ms epoch */
  lastConfirmed?: number;
  lastMissed?: number;
}

export type Band = "confirmed" | "likely" | "guess";

export const CONFIRM_GAP_SHARE = 0.3;
export const MISS_STEP = 0.3;
export const MISS_FLOOR = 0.05;
const DAY = 86_400_000;
export const DECAY_AFTER_MS = 90 * DAY;
export const DECAY_EVERY_MS = 30 * DAY;
export const DECAY_STEP = 0.1;
export const DECAY_FLOOR = 0.4;
export const BAND_CONFIRMED = 0.8;
export const BAND_LIKELY = 0.5;

const clamp = (c: number) => Math.max(0, Math.min(1, c));

/** the band a confidence falls in; the edges belong to the higher band */
export function band(confidence: number): Band {
  return confidence >= BAND_CONFIRMED ? "confirmed" : confidence >= BAND_LIKELY ? "likely" : "guess";
}

/** "Got it": 30% of the way to 1 */
export function confirmed<T extends ConfidenceRecord>(r: T, now: number): T & { confidence: number; confirms: number; lastConfirmed: number } {
  const c = clamp(r.confidence ?? 1);
  return { ...r, confidence: c + (1 - c) * CONFIRM_GAP_SHARE, confirms: (r.confirms ?? 0) + 1, lastConfirmed: now };
}

/** "Not here": −0.3, floor 0.05 */
export function missed<T extends ConfidenceRecord>(r: T, now: number): T & { confidence: number; misses: number; lastMissed: number } {
  const c = clamp(r.confidence ?? 1);
  return { ...r, confidence: Math.max(MISS_FLOOR, c - MISS_STEP), misses: (r.misses ?? 0) + 1, lastMissed: now };
}

/** the confidence to read now: stored value less time decay; a record never confirmed does not decay */
export function decayed(r: ConfidenceRecord, now: number): number {
  const c = clamp(r.confidence ?? 1);
  if (r.lastConfirmed === undefined) return c;
  const overdue = now - r.lastConfirmed - DECAY_AFTER_MS;
  if (overdue <= 0 || c <= DECAY_FLOOR) return c;
  const steps = Math.floor(overdue / DECAY_EVERY_MS);
  return Math.max(DECAY_FLOOR, c - DECAY_STEP * steps);
}

/** a copy with the decayed confidence in place (for display or export; the store keeps the original) */
export function withDecay<T extends ConfidenceRecord>(r: T, now: number): T {
  const c = decayed(r, now);
  return c === (r.confidence ?? 1) ? r : { ...r, confidence: c };
}

/** days since the last confirmation, or null when never confirmed */
export const daysSinceConfirmed = (r: ConfidenceRecord, now: number) => (r.lastConfirmed === undefined ? null : Math.floor((now - r.lastConfirmed) / DAY));
