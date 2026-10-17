import { useRef, useState } from "react";
import { band, type Router, type StoreGraph } from "@grosher/core";
import { aislesNeverEntered, elapsedMs, summarize, type TripState } from "../lib/trip.ts";
import type { TripRecord } from "../lib/history.ts";
import { clock, WALK_MPS } from "../lib/format.ts";
import { renderCardPng, shareOrDownload } from "../lib/share.ts";
import { ShareCard, type ShareCardData } from "./ShareCard.tsx";
import { Ground } from "./Ground.tsx";
import { IconCheck, IconUpload } from "./Icons.tsx";

export interface CheckoutScreenProps {
  store: StoreGraph;
  router: Router;
  /** the live trip just finished, or a past trip from history (read-only) */
  trip?: TripState;
  record?: TripRecord;
  /** the trip before this one at this store, for "vs your last trip" */
  previous?: TripRecord;
  usualSaved: boolean;
  noted: Set<string>;
  onNote: (name: string) => void;
  onSaveUsual: () => void;
  onClose: () => void;
}

const laneLabel = (lane: string | null) => (lane ? lane.replace(/^L/, "").replace(/^(\d+)$/, (m) => String(Number(m) + 1)) : null);

/** "3 min faster than your last trip · 40 m less" */
export function vsLastLine(timeMs: number, walkedM: number, previous: TripRecord | undefined): string | undefined {
  if (!previous) return undefined;
  const dMin = Math.round((previous.timeMs - timeMs) / 60_000);
  const dM = Math.round(previous.walkedM - walkedM);
  const time = dMin === 0 ? "Same time as your last trip" : `${Math.abs(dMin)} min ${dMin > 0 ? "faster" : "slower"} than your last trip`;
  const walk = Math.abs(dM) < 5 ? "" : ` · ${Math.abs(dM)} m ${dM > 0 ? "less" : "more"}`;
  return time + walk;
}

export function cardDataFromRecord(store: StoreGraph, r: TripRecord, previous?: TripRecord): ShareCardData {
  const total = r.bought.length + r.skipped.length + r.unknown.length;
  const savedPct = r.baselineM > 0 ? Math.round((1 - r.walkedM / r.baselineM) * 100) : 0;
  const weekday = new Date(r.date).toLocaleDateString(undefined, { weekday: "short" });
  const place = (store.address ?? store.name ?? store.storeId).split("·")[0].trim();
  return {
    clock: clock(r.timeMs),
    got: r.bought.length,
    total,
    lane: laneLabel(r.lane),
    walkedM: r.walkedM,
    aislesNever: r.aislesNever,
    savedPct,
    savedMinutes: Math.round(Math.max(0, r.savedM) / WALK_MPS / 60),
    storeTag: `${place} · ${weekday}`,
    vsLast: vsLastLine(r.timeMs, r.walkedM, previous),
  };
}

export function cardData(store: StoreGraph, router: Router, trip: TripState, previous?: TripRecord): ShareCardData {
  const s = summarize(router, trip);
  const lane = trip.route.legs.find((l) => l.label === "Checkout")?.nodeId ?? null;
  const savedPct = s.baselineM > 0 ? Math.round((1 - s.totalM / s.baselineM) * 100) : 0;
  const weekday = new Date(trip.doneAt ?? Date.now()).toLocaleDateString(undefined, { weekday: "short" });
  const place = (store.address ?? store.name ?? store.storeId).split("·")[0].trim();
  return {
    clock: clock(elapsedMs(trip)),
    got: trip.got.length,
    total: trip.original.length,
    lane: laneLabel(lane),
    walkedM: s.totalM,
    aislesNever: aislesNeverEntered(store, trip).never.length,
    savedPct,
    savedMinutes: Math.round(Math.max(0, s.savedM) / WALK_MPS / 60),
    storeTag: `${place} · ${weekday}`,
    vsLast: vsLastLine(elapsedMs(trip), s.totalM, previous),
  };
}

const AISLE = /^A\d+$/i;
const where = (store: StoreGraph, locId: string) => {
  const loc = store.locations.find((l) => l.id === locId);
  if (!loc) return "somewhere else";
  return AISLE.test(loc.aisle) ? `in ${loc.aisle.toUpperCase()}` : `on the ${loc.aisle.toLowerCase()}`;
};

interface Ask {
  key: string;
  question: string;
  hint: string;
  confirmed?: boolean;
}

/** Rows for the "Make the map better" section: unplaced, skipped, and corrected (an alternate shelf was used). */
export function mapQuestions(store: StoreGraph, trip: TripState): Ask[] {
  const out: Ask[] = [];
  for (const name of trip.unplaced) out.push({ key: `unplaced:${name.toLowerCase()}`, question: `Where did you find the ${name.toLowerCase()}?`, hint: "Not on the map yet · tap the aisle, or skip" });
  // every "Not here": a guess that missed is the map's best lead on a reset; a confirmed shelf that missed says the store changed
  for (const s of trip.skipped) out.push({ key: `skipped:${s.query ?? s.name}`, question: `Where was the ${s.name.toLowerCase()}?`, hint: band(s.confidence ?? 1) === "guess" ? "A guess that was wrong · tap the aisle, or skip" : "Not where the map said · tap the aisle, or skip" });
  trip.got.forEach((s, i) => {
    const node = trip.doneNodeIds[i];
    const used = node?.startsWith("loc:") ? node.slice(4) : undefined;
    if (used && s.locationIds.length > 1 && used !== s.locationIds[0]) {
      out.push({ key: `confirmed:${s.id}`, question: `${s.name} ${s.name.endsWith("s") ? "were" : "was"} ${where(store, used)}`, hint: "Confirmed · the map learns from this", confirmed: true });
    }
  });
  return out;
}

export function CheckoutScreen({ store, router, trip, record, previous, usualSaved, noted, onNote, onSaveUsual, onClose }: CheckoutScreenProps) {
  const data = trip ? cardData(store, router, trip, previous) : cardDataFromRecord(store, record!, previous);
  const asks = trip ? mapQuestions(store, trip) : [];
  const readOnly = !trip;
  const exportRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState<"idle" | "busy" | "done" | "failed">("idle");

  const share = async () => {
    if (!exportRef.current) return;
    setSharing("busy");
    try {
      const blob = await renderCardPng(exportRef.current);
      await shareOrDownload(blob, `grosher-${data.clock.replace(":", "-")}.png`);
      setSharing("done");
    } catch {
      setSharing("failed");
    }
  };

  return (
    <main className="screen page done-page">
      <header className="done-head on-haze">
        <h1 className="heading" style={{ fontSize: 20, fontWeight: 400 }}>
          {readOnly ? new Date(record!.date).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "Trip done"}
        </h1>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>

      <ShareCard data={data} />

      {asks.length > 0 && (
        <section className="improve">
          <span className="eyebrow">Make the map better</span>
          {asks.map((a) => (
            <div key={a.key} className="improve-row glass-deep" data-testid="improve-row">
              <div>
                <p className="q">{a.question}</p>
                <p className="hint">{a.hint}</p>
              </div>
              {a.confirmed ? (
                <span className="confirm" aria-label="Confirmed">
                  <IconCheck />
                </span>
              ) : noted.has(a.key.replace(/^(unplaced|skipped):/, "")) ? (
                <span className="pill ghost">Noted</span>
              ) : (
                <button type="button" className="pill lime" onClick={() => onNote(a.key.replace(/^(unplaced|skipped):/, ""))}>
                  Pick aisle
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      <div className="done-actions">
        <button type="button" className="pill white primary" onClick={share} disabled={sharing === "busy"}>
          <IconUpload />
          {sharing === "busy" ? "Rendering" : sharing === "failed" ? "Try again" : "Share card"}
        </button>
        <button type="button" className="pill primary" onClick={onSaveUsual} disabled={usualSaved}>
          {usualSaved ? "Saved as usual" : "Save as usual trip"}
        </button>
      </div>

      {/* 1080×1920 export copy, off-screen */}
      <div ref={exportRef} className="share-export" aria-hidden>
        <div className="bloom bloom-cream" />
        <div className="bloom bloom-lime" />
        <div className="bloom bloom-deep" />
        <div className="scale">
          <ShareCard data={data} />
        </div>
      </div>
    </main>
  );
}

export { Ground };
