import { useRef, useState } from "react";
import type { Router, StoreGraph } from "@grosher/core";
import { aislesNeverEntered, elapsedMs, summarize, type TripState } from "../lib/trip.ts";
import { clock, WALK_MPS } from "../lib/format.ts";
import { renderCardPng, shareOrDownload } from "../lib/share.ts";
import { ShareCard, type ShareCardData } from "./ShareCard.tsx";
import { Ground } from "./Ground.tsx";
import { IconUpload } from "./Icons.tsx";

export interface CheckoutScreenProps {
  store: StoreGraph;
  router: Router;
  trip: TripState;
  usualSaved: boolean;
  noted: Set<string>;
  onNote: (name: string) => void;
  onSaveUsual: () => void;
  onClose: () => void;
}

export function cardData(store: StoreGraph, router: Router, trip: TripState): ShareCardData {
  const s = summarize(router, trip);
  const lane = trip.route.legs.find((l) => l.label === "Checkout")?.nodeId ?? null;
  const savedPct = s.baselineM > 0 ? Math.round((1 - s.totalM / s.baselineM) * 100) : 0;
  const weekday = new Date(trip.doneAt ?? Date.now()).toLocaleDateString(undefined, { weekday: "short" });
  const place = (store.address ?? store.name ?? store.storeId).split("·")[0].trim();
  return {
    clock: clock(elapsedMs(trip)),
    got: trip.got.length,
    total: trip.original.length,
    lane: lane ? lane.replace(/^L/, "").replace(/^(\d+)$/, (m) => String(Number(m) + 1)) : null,
    walkedM: s.totalM,
    aislesNever: aislesNeverEntered(store, trip).never.length,
    savedPct,
    savedMinutes: Math.round(Math.max(0, s.savedM) / WALK_MPS / 60),
    storeTag: `${place} · ${weekday}`,
  };
}

export function CheckoutScreen({ store, router, trip, usualSaved, noted, onNote, onSaveUsual, onClose }: CheckoutScreenProps) {
  const data = cardData(store, router, trip);
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
          Trip done
        </h1>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>

      <ShareCard data={data} />

      {trip.skipped.length > 0 && (
        <section className="improve">
          <span className="eyebrow">Make the map better</span>
          {trip.skipped.map((s) => (
            <div key={s.id} className="improve-row glass" data-testid="improve-row">
              <div>
                <p className="q">Where was the {s.name.toLowerCase()}?</p>
                <p className="hint">Not where the map said. Tell us the aisle next time you see it.</p>
              </div>
              {noted.has(s.id) ? (
                <span className="pill ghost">Noted</span>
              ) : (
                <button type="button" className="pill lime" onClick={() => onNote(s.id)}>
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
