// Trip (DESIGN.md §5): full-screen map, glass header with the Doto timer and
// the flatten button, progress strip, glass bottom sheet.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Router, Stop } from "@grosher/core";
import type { StoreBundle } from "@grosher/stores";
import { elapsedMs, isDone, nextLeg, nextStop, type TripState } from "../lib/trip.ts";
import { clock, describeLocation, laneName, WALK_MPS } from "../lib/format.ts";
import { band } from "@grosher/core";
import { locationDepartment } from "../lib/chips.ts";
import { slotFor } from "@grosher/stores";
import { webglAvailable } from "../map3d/webgl.ts";
import { StoreMap } from "./StoreMap.tsx";
import { AddItem } from "./AddItem.tsx";
import { Num } from "./Num.tsx";
import { IconArrowLeft, IconCheck, IconClose, IconLayers, IconPlus } from "./Icons.tsx";

import { FallbackBoundary } from "./ErrorBoundary.tsx";
import { closeUpAt } from "../hero/index.ts";
import { GUARD, type GuardMode } from "../lib/guard.ts";
import { motionFeed, useGuard, type GuardFeed } from "../lib/useGuard.ts";
import { DemoWalk } from "../lib/demoWalk.ts";

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
  /** the off-list guard (Settings), and the demo walk (?demo=walk) */
  guardMode?: GuardMode;
  demo?: boolean;
  /** the guard's counts for this trip, onto the trip (the checkout line) */
  onGuardCounts?: (detours: number, offRouteMs: number) => void;
  /** "Can't find it?" → Tell me where: the picker for the stop's item */
  onTellWhere?: (name: string) => void;
  /** the demo walk checks stops off itself (no learning: it is not the shopper's word) */
  onDemoGotIt?: () => void;
}


export function TripScreen({ bundle, router, trip, flat, onFlatChange, onGotIt, onSkip, onAdd, onBack, guardMode = "gentle", demo = false, onGuardCounts, onTellWhere, onDemoGotIt }: TripScreenProps) {
  const { store, catalog } = bundle;
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const [addOpen, setAddOpen] = useState(false);
  // the map may use the area between the progress strip and the bottom sheet
  const screenRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const [safe, setSafe] = useState({ top: 0.16, bottom: 0.36 });
  useEffect(() => {
    const el = screenRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const h = el.clientHeight || 844;
      const strip = el.querySelector(".progress-strip")?.getBoundingClientRect();
      const sheet = sheetRef.current?.getBoundingClientRect();
      const top = strip ? (strip.bottom - el.getBoundingClientRect().top + 12) / h : 0.16;
      const bottom = sheet ? (el.getBoundingClientRect().bottom - sheet.top + 8) / h : 0.36;
      setSafe((s) => (Math.abs(s.top - top) > 0.005 || Math.abs(s.bottom - bottom) > 0.005 ? { top, bottom } : s));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (sheetRef.current) ro.observe(sheetRef.current);
    return () => ro.disconnect();
  }, [addOpen, trip.remaining.length]);
  const webgl = useMemo(() => webglAvailable(), []);
  // a hero close-up is open: the header sits over the zone's dark ceiling, not the sky
  const [closeUp, setCloseUp] = useState(false);
  const leaveCloseUp = useRef<(() => void) | null>(null);
  // without WebGL the hero zone's flat shelf image stands in for the close-up (closed per stop)
  const [shelfOpenFor, setShelfOpenFor] = useState<string | null>(null);
  const perf = typeof location !== "undefined" && new URLSearchParams(location.search).has("perf");
  // the off-list guard: the phone's motion for this trip (in memory only), or the demo's scripted walk
  const [animating, setAnimating] = useState(false);
  const [feed, setFeed] = useState<GuardFeed | null>(null);
  useEffect(() => {
    const f = demo ? new DemoWalk() : guardMode !== "off" ? motionFeed() : null;
    setFeed(f);
    return () => f?.stop();
  }, [trip.startedAt, demo, guardMode]);
  // the card takes part of the map's area: docked at the top in a close-up (the close-up camera frames the lit
  // slot below it), above the bottom card on the map (the overview frames above it, and a stop it would cover
  // becomes an edge chip): both follow the safe area
  const guardRef = useRef<HTMLElement>(null);
  const [guardEdge, setGuardEdge] = useState<number | null>(null);
  const guard = useGuard({ store, trip, mode: demo ? "gentle" : guardMode, animating, feed, onCounts: (d, ms) => onGuardCounts?.(d, ms), onGotIt: onDemoGotIt, walker: demo ? { strideM: GUARD.strideM, speedMps: GUARD.speedMps } : undefined });
  const mapSafe = useMemo(() => (guardEdge === null ? safe : closeUp ? { ...safe, top: Math.max(safe.top, guardEdge) } : { ...safe, bottom: Math.max(safe.bottom, guardEdge) }), [safe, guardEdge, closeUp]);

  useEffect(() => {
    const el = guardRef.current;
    const screen = screenRef.current;
    if (!guard.show || !el || !screen) return setGuardEdge(null);
    const h = screen.clientHeight || 844;
    const box = screen.getBoundingClientRect();
    const card = el.getBoundingClientRect();
    setGuardEdge(closeUp ? (card.bottom - box.top + 8) / h : (box.bottom - card.top + 8) / h);
  }, [guard.show, closeUp]);
  const leg = nextLeg(trip);
  const stop = nextStop(trip);
  const position = trip.got.length + trip.skipped.length + 1;
  // stops the map could not place left the route for the checkout question: not counted here
  const total = trip.original.filter((s) => !trip.unplaced.includes(s.name)).length;
  const doneCount = trip.got.length + trip.skipped.length;

  const loc = leg ? store.locations.find((l) => l.id === leg.locationId) : undefined;
  const hero = !webgl && leg ? closeUpAt(store, bundle.categories, leg.locationId) : null;
  const shelfImage = hero ? hero.zone.flatImage(hero.category) : null;
  const dept = locationDepartment(store, loc);
  const tags = stop?.tags ?? [];
  const hint = tags.includes("hot") ? " · hot, so it's near the end" : tags.includes("frozen") || tags.includes("chilled") ? " · cold, so it's near the end" : tags.includes("heavy") ? " · heavy, so it's early" : tags.includes("bulky") ? " · bulky, under the cart" : "";
  const locationLine = leg ? `${describeLocation(store, leg.locationId)}${hint}` : "";

  const remainingM = trip.route.legs.reduce((s, l) => s + l.distanceM, 0);
  const lane = trip.route.legs.find((l) => l.label === "Checkout");
  // the department, then the aisle number on a numbered aisle ("Snacks · A12"); a wall or counter's code
  // ("BODYCARE") would only repeat its department's name
  const eyebrowParts = [dept?.name, loc && (/^A\d+$/i.test(loc.aisle) || !dept) ? loc.aisle : undefined].filter((p): p is string => !!p);
  const slot = loc ? slotFor(store, loc) : undefined;
  const sideWord = loc?.side === "R" ? "Right" : loc?.side === "E" ? "Endcap" : "Left";
  const slotLine = slot ? `${sideWord} · bay ${slot.bay} · shelf ${slot.shelf + 1}` : undefined;
  const nextLabel = leg && stop ? { eyebrow: `${eyebrowParts.join(" · ")} · ${position} of ${total}`, name: stop.name, distance: `${Math.round(leg.distanceM)} m`, slot: slotLine } : null;
  const checkoutLabel = lane ? { eyebrow: `Checkout · ${laneName(lane.nodeId)}`, line: `${Math.max(1, Math.round(remainingM / WALK_MPS / 60))} min walk (${Math.round(remainingM)} m)` } : null;

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
  const vignette = <div className="trip-vignette" aria-hidden />;

  return (
    <div className={[closeUp ? "trip-screen is-closeup" : "trip-screen", guard.show && !closeUp ? "guard-up" : ""].filter(Boolean).join(" ")} ref={screenRef}>
      <div className="trip-map">
        {webgl ? (
          <FallbackBoundary name="3D map" fallback={<>{flatMap}{vignette}</>}>
            <Suspense fallback={flatMap}>
              <TripMap3D bundle={bundle} trip={trip} flat={flat} onFlatChange={onFlatChange} nextLabel={nextLabel} checkoutLabel={checkoutLabel} perf={perf} safe={mapSafe} onCloseUpChange={setCloseUp} onAnimatingChange={setAnimating} backRef={leaveCloseUp} />
            </Suspense>
          </FallbackBoundary>
        ) : (
          <>
            {flatMap}
            {vignette}
            {/* no 3D: a stop in a hero zone shows the shelf as a flat image, the stop's bin lit */}
            {shelfImage && shelfOpenFor !== leg?.stopId && (
              <figure className="flat-shelf" data-testid="flat-shelf">
                <img src={shelfImage} alt={`The shelf where ${stop?.name ?? "it"} is, lit in lime`} />
                <figcaption>
                  <span>{stop?.name}</span>
                  <button type="button" className="pill closeup-back-inline" onClick={() => setShelfOpenFor(leg?.stopId ?? null)}>
                    Close
                  </button>
                </figcaption>
              </figure>
            )}
          </>
        )}
      </div>

      <header className="trip-head">
        {closeUp ? (
          // in a close-up the bar is one way back: to the map (leaving the trip and flattening are the map's)
          <button type="button" className="pill trip-title closeup-back" onClick={() => leaveCloseUp.current?.()}>
            <IconArrowLeft />
            <span className="trip-store">Back to the map</span>
            <Num value={clock(elapsedMs(trip))} />
          </button>
        ) : (
          <>
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
          </>
        )}
      </header>
      <div className="progress-strip" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount} aria-label="Trip progress">
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={`seg ${i < doneCount ? "done" : i === doneCount ? "current" : ""}`} />
        ))}
      </div>

      {demo && (
        <span className="demo-badge" data-testid="demo-walk">
          demo walk
        </span>
      )}

      {/* the off-list guard: above the bottom card on the map; at the top in a close-up, clear of the lit slot */}
      {guard.show && !isDone(trip) && (
        <section ref={guardRef} className={`guard-card${closeUp ? " docked" : ""}`} role="status" aria-live="polite" data-testid="guard-card" style={closeUp ? undefined : { bottom: `calc(${(safe.bottom * 100).toFixed(1)}% + 4px)` }}>
          {guard.show.kind === "guard" ? (
            <>
              <p className="guard-title">Nothing on your list here.</p>
              {guard.show.item && (
                <p className="guard-line">
                  {guard.show.item} is <Num value={guard.show.aheadM} /> m ahead.
                </p>
              )}
              <div className="guard-actions">
                <button type="button" className="pill lime" onClick={guard.back}>
                  Back on route
                </button>
                <button
                  type="button"
                  className="pill"
                  onClick={() => {
                    guard.dismiss();
                    setAddOpen(true);
                  }}
                >
                  I'm grabbing something
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="guard-title">Can't find {guard.show.item ?? "it"}?</p>
              <div className="guard-actions">
                {onTellWhere && guard.show.item && (
                  <button
                    type="button"
                    className="pill lime"
                    onClick={() => {
                      const name = guard.show?.item;
                      guard.dismiss();
                      if (name) onTellWhere(name);
                    }}
                  >
                    Tell me where
                  </button>
                )}
                <button
                  type="button"
                  className="pill"
                  onClick={() => {
                    guard.dismiss();
                    onSkip();
                  }}
                >
                  Not here
                </button>
                <button type="button" className="pill circle" aria-label="Close" onClick={guard.dismiss}>
                  <IconClose />
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {!isDone(trip) && leg && stop && (
        <section className="trip-sheet glass sheet" aria-label="Trip" ref={sheetRef}>
          <span className="eyebrow now">
            Next · {position} of {total}
          </span>
          <div className="trip-row">
            <div>
              <h2 className="title">{stop.name}</h2>
              <p className="muted trip-where">{locationLine}</p>
              {band(stop.confidence ?? 1) === "guess" && (
                <p className="trip-guess" data-testid="trip-guess">
                  Probably here · tell me if not
                </p>
              )}
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
