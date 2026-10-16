// Trip (DESIGN.md §5): full-screen map, glass header with the Doto timer and
// the flatten button, progress strip, glass bottom sheet.

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { Router, Stop } from "@grosher/core";
import type { StoreBundle } from "@grosher/stores";
import { elapsedMs, isDone, nextLeg, nextStop, type TripState } from "../lib/trip.ts";
import { clock, describeLocation, WALK_MPS } from "../lib/format.ts";
import { locationDepartment } from "../lib/chips.ts";
import { webglAvailable } from "../map3d/webgl.ts";
import { StoreMap } from "./StoreMap.tsx";
import { AddItem } from "./AddItem.tsx";
import { Num } from "./Num.tsx";
import { IconArrowLeft, IconCheck, IconLayers, IconPlus } from "./Icons.tsx";

const TripMap3D = lazy(() => import("../map3d/TripMap3D.tsx"));

export interface TripScreenProps {
  bundle: StoreBundle;
  router: Router;
  trip: TripState;
  flat: boolean;
  onFlatChange: (flat: boolean) => void;
  onGotIt: () => void;
  onSkip: () => void;
  onAdd: (stop: Stop) => void;
  onBack: () => void;
}

const laneNumber = (nodeId: string) => nodeId.replace(/^L/, "").replace(/^(\d+)$/, (m) => String(Number(m) + 1));

export function TripScreen({ bundle, router, trip, flat, onFlatChange, onGotIt, onSkip, onAdd, onBack }: TripScreenProps) {
  const { store, catalog } = bundle;
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const [addOpen, setAddOpen] = useState(false);
  const webgl = useMemo(() => webglAvailable(), []);
  const perf = typeof location !== "undefined" && new URLSearchParams(location.search).has("perf");

  const leg = nextLeg(trip);
  const stop = nextStop(trip);
  const position = trip.got.length + trip.skipped.length + 1;
  const total = trip.original.length;
  const doneCount = trip.got.length + trip.skipped.length;

  const loc = leg ? store.locations.find((l) => l.id === leg.locationId) : undefined;
  const dept = locationDepartment(store, loc);
  const tags = stop?.tags ?? [];
  const hint = tags.includes("frozen") || tags.includes("chilled") ? " · cold, so it's near the end" : tags.includes("heavy") ? " · heavy, so it's early" : "";
  const locationLine = leg ? `${describeLocation(store, leg.locationId)}${hint}` : "";

  const remainingM = trip.route.legs.reduce((s, l) => s + l.distanceM, 0);
  const lane = trip.route.legs.find((l) => l.label === "Checkout");
  const nextLabel = leg && stop ? { eyebrow: `${dept?.name ?? loc?.aisle ?? ""} · ${loc?.aisle ?? ""} · ${position} of ${total}`, name: stop.name, distance: `${Math.round(leg.distanceM)} m` } : null;
  const checkoutLabel = lane ? { eyebrow: `Checkout · lane ${laneNumber(lane.nodeId)}`, line: `${Math.max(1, Math.round(remainingM / WALK_MPS / 60))} min walk (${Math.round(remainingM)} m)` } : null;

  const flatMap = (
    <StoreMap
      store={store}
      route={trip.route}
      currentNodeId={leg?.nodeId ?? null}
      positionNodeId={trip.positionNodeId}
      walkedPath={trip.visited}
      doneNodeIds={trip.doneNodeIds}
      className="trip-flat"
    />
  );

  return (
    <div className="trip-screen">
      <div className="trip-map">
        {webgl ? (
          <Suspense fallback={flatMap}>
            <TripMap3D bundle={bundle} trip={trip} flat={flat} onFlatChange={onFlatChange} nextLabel={nextLabel} checkoutLabel={checkoutLabel} perf={perf} />
          </Suspense>
        ) : (
          flatMap
        )}
      </div>

      <header className="trip-head">
        <button type="button" className="pill circle" aria-label="Back to the list" onClick={onBack}>
          <IconArrowLeft />
        </button>
        <div className="pill trip-title">
          <span className="trip-store">{store.name ?? store.storeId}</span>
          <Num value={clock(elapsedMs(trip))} />
        </div>
        <button type="button" className="pill circle" aria-label={flat ? "Tilt the map" : "Flatten the map"} aria-pressed={flat} onClick={() => onFlatChange(!flat)}>
          <IconLayers />
        </button>
      </header>
      <div className="progress-strip" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount} aria-label="Trip progress">
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={`seg ${i < doneCount ? "done" : i === doneCount ? "current" : ""}`} />
        ))}
      </div>

      {!isDone(trip) && leg && stop && (
        <section className="trip-sheet glass sheet" aria-label="Trip">
          <span className="eyebrow now">
            Next · {position} of {total}
          </span>
          <div className="trip-row">
            <div>
              <h2 className="title">{stop.name}</h2>
              <p className="muted trip-where">{locationLine}</p>
            </div>
            <div className="trip-dist">
              <Num value={Math.round(leg.distanceM)} />
              <span className="muted">meters</span>
            </div>
          </div>
          <div className="trip-actions">
            <button type="button" className="pill lime primary" onClick={onGotIt}>
              <IconCheck />
              Got it
            </button>
            <button type="button" className="pill primary" onClick={onSkip}>
              Not here
            </button>
            <button type="button" className="pill circle big" aria-label="Add item" aria-expanded={addOpen} onClick={() => setAddOpen((o) => !o)}>
              <IconPlus />
            </button>
          </div>
          {addOpen && (
            <AddItem
              catalog={catalog}
              trip={trip}
              onAdd={(s) => {
                onAdd(s);
                setAddOpen(false);
              }}
            />
          )}
        </section>
      )}
    </div>
  );
}
