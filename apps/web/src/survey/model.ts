// A store survey: one walk through the store, recorded raw so the map can be derived again later (a better
// stride, a fixed heading). Pure data and operations; SurveyScreen owns the sensors and the UI, derive.ts
// turns a survey into metres and a draft map.
//
// Raw, never rewritten by derivation:
//   steps     every detected step's time (ms epoch) over the whole survey
//   headings  [time, compass degrees] samples (≤ 2 Hz)
//   events    the taps: entrance, aisle start / end, pins, in time order
//   photos    sign photos by id (the JPEGs live in IndexedDB under survey-photo:<id>), each with its reading
// A movement between two taps is a leg: its steps are the step times between them, its heading the mean of
// the samples between them; a cross walk is the leg from an aisle's end to the next aisle's start.

import type { SignReading } from "@grosher/core";
import type { MotionTrace } from "./steps.ts";

export const SURVEY_FORMAT = "grosher.survey";
export const SURVEY_VERSION = 1;

/** "Walk 10 m": the stride (metres per step) and the pace (metres per second, for timing without motion) */
export interface Calibration {
  distanceM: number;
  steps: number | null;
  durationMs: number;
  strideM: number | null;
  paceMps: number;
  at: number;
  /** the walk's raw accelerometer samples, so a real trace can become a detector fixture */
  trace?: MotionTrace;
}

export const PIN_LABELS = ["Produce", "Dairy wall", "Meat", "Frozen", "Bakery", "Deli", "Pharmacy", "Checkout lane", "Exit", "Custom"] as const;
export type PinLabel = (typeof PIN_LABELS)[number];

export type SurveyEvent =
  | { kind: "entrance"; id: string; t: number }
  | { kind: "start"; id: string; t: number; number?: string; endcap?: boolean; oneSide?: boolean }
  | { kind: "end"; id: string; t: number; startId: string }
  | { kind: "pin"; id: string; t: number; label: PinLabel; name?: string };

export type PhotoStatus = "queued" | "reading" | "done" | "failed";

export interface SurveyPhoto {
  id: string;
  t: number;
  w: number;
  h: number;
  status: PhotoStatus;
  attempts: number;
  /** when a failed reading is tried again (ms epoch) */
  retryAt?: number;
  /** the sign's lines as the model read them, and what they matched */
  words?: string[];
  reading?: SignReading;
  /** one line for the list: why the last attempt failed */
  error?: string;
}

export interface Survey {
  format: typeof SURVEY_FORMAT;
  version: number;
  id: string;
  storeId: string;
  name: string;
  address?: string;
  createdAt: number;
  updatedAt: number;
  calibration: Calibration | null;
  /** steps were counted from motion (else every leg is timed and the pace used) */
  motion: boolean;
  /** the compass heading at the entrance tap: the store's reference axis ("into the store") */
  referenceHeading: number | null;
  steps: number[];
  headings: [number, number][];
  events: SurveyEvent[];
  photos: SurveyPhoto[];
}

export const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function newSurvey(o: { storeId: string; name: string; address?: string; calibration: Calibration | null; now?: number }): Survey {
  const now = o.now ?? Date.now();
  return { format: SURVEY_FORMAT, version: SURVEY_VERSION, id: uid("sv"), storeId: o.storeId, name: o.name, address: o.address, createdAt: now, updatedAt: now, calibration: o.calibration, motion: true, referenceHeading: null, steps: [], headings: [], events: [], photos: [] };
}

/** where the walk is: before the entrance, between aisles, or inside one */
export type Phase = { kind: "before" } | { kind: "between"; since: number } | { kind: "aisle"; start: Extract<SurveyEvent, { kind: "start" }> };

export function phaseOf(s: Survey): Phase {
  const last = s.events[s.events.length - 1];
  if (!last) return { kind: "before" };
  if (last.kind === "start") return { kind: "aisle", start: last };
  return { kind: "between", since: last.t };
}

export const stepsBetween = (s: Survey, from: number, to: number) => s.steps.filter((t) => t >= from && t < to).length;

const touch = (s: Survey, now: number): Survey => ({ ...s, updatedAt: now });

// each tap takes its event id from the caller when it wants to record it for Undo (an updater stays pure)

export function tapEntrance(s: Survey, t: number, heading: number | null, id = uid("ev")): Survey {
  if (s.events.length) return s;
  return touch({ ...s, referenceHeading: heading, events: [{ kind: "entrance", id, t }] }, t);
}

export function startAisle(s: Survey, t: number, id = uid("ai")): Survey {
  if (phaseOf(s).kind !== "between") return s;
  return touch({ ...s, events: [...s.events, { kind: "start", id, t }] }, t);
}

export function endAisle(s: Survey, t: number, id = uid("ev")): Survey {
  const p = phaseOf(s);
  if (p.kind !== "aisle") return s;
  return touch({ ...s, events: [...s.events, { kind: "end", id, t, startId: p.start.id }] }, t);
}

export function dropPin(s: Survey, t: number, label: PinLabel, name?: string, id = uid("pin")): Survey {
  if (phaseOf(s).kind === "before") return s;
  return touch({ ...s, events: [...s.events, { kind: "pin", id, t, label, name: name?.trim() || undefined }] }, t);
}

/** the quick tags on an aisle (the one being walked, or any earlier one) */
export function tagAisle(s: Survey, startId: string, patch: { number?: string; endcap?: boolean; oneSide?: boolean }, now = Date.now()): Survey {
  return touch({ ...s, events: s.events.map((e) => (e.kind === "start" && e.id === startId ? { ...e, ...patch } : e)) }, now);
}

export function addPhoto(s: Survey, p: { id: string; t: number; w: number; h: number }): Survey {
  return touch({ ...s, photos: [...s.photos, { ...p, status: "queued", attempts: 0 }] }, p.t);
}

export function updatePhoto(s: Survey, id: string, patch: Partial<SurveyPhoto>, now = Date.now()): Survey {
  return touch({ ...s, photos: s.photos.map((p) => (p.id === id ? { ...p, ...patch } : p)) }, now);
}

/** the aisle a photo belongs to: the one being walked when it was taken, else the next one started */
export function aisleOfPhoto(s: Survey, photo: { t: number }): string | null {
  let pending: string | null = null;
  for (const e of s.events) {
    if (e.kind === "start") {
      const end = s.events.find((x) => x.kind === "end" && x.startId === e.id);
      if (photo.t >= e.t && (!end || photo.t <= end.t)) return e.id;
      if (photo.t < e.t && pending === null) pending = e.id;
    }
  }
  return pending;
}

// ---------------------------------------------------------------- the file (export / import)

export interface SurveyFile extends Survey {
  /** photo id → data: URL (JPEG), so one file carries the whole survey (AirDrop to the Mac) */
  photoData?: Record<string, string>;
}

/** A survey file from disk → a survey and its photos, or why not. */
export function parseSurveyFile(raw: unknown): { survey: Survey; photoData: Record<string, string> } {
  const o = raw as Partial<SurveyFile> | null;
  if (!o || typeof o !== "object" || o.format !== SURVEY_FORMAT) throw new Error("Not a Grosher survey file.");
  if (typeof o.version !== "number" || o.version > SURVEY_VERSION) throw new Error(`Survey version ${o.version} is newer than this app understands.`);
  if (!Array.isArray(o.events) || !Array.isArray(o.steps) || !Array.isArray(o.headings) || !Array.isArray(o.photos) || typeof o.storeId !== "string") throw new Error("The survey file is incomplete.");
  const { photoData = {}, ...survey } = o as SurveyFile;
  // a photo in the middle of being read when exported is read again here
  return { survey: { ...survey, photos: survey.photos.map((p) => (p.status === "reading" ? { ...p, status: "queued" as const } : p)) }, photoData };
}

// ---------------------------------------------------------------- undo

/** What a tap did, so Undo reverses exactly that (and not a sign reading that finished since). */
export type SurveyAction =
  | { kind: "event"; id: string }
  | { kind: "photo"; id: string }
  | { kind: "tag"; startId: string; prev: { number?: string; endcap?: boolean; oneSide?: boolean } };

export function undo(s: Survey, a: SurveyAction, now = Date.now()): Survey {
  if (a.kind === "photo") return touch({ ...s, photos: s.photos.filter((p) => p.id !== a.id) }, now);
  if (a.kind === "tag") return tagAisle(s, a.startId, a.prev, now);
  const ev = s.events.find((e) => e.id === a.id);
  if (!ev) return s;
  // an aisle's start goes with its end
  const events = s.events.filter((e) => e.id !== a.id && !(e.kind === "end" && e.startId === a.id));
  return touch({ ...s, events, referenceHeading: ev.kind === "entrance" ? null : s.referenceHeading }, now);
}

/** a short line for the running list and the Undo button */
export function describeAction(s: Survey, a: SurveyAction): string {
  if (a.kind === "photo") return "sign photo";
  if (a.kind === "tag") return "aisle tags";
  const e = s.events.find((x) => x.id === a.id);
  if (!e) return "";
  return e.kind === "entrance" ? "entrance" : e.kind === "start" ? "aisle start" : e.kind === "end" ? "aisle end" : `pin ${e.name ?? e.label}`;
}
