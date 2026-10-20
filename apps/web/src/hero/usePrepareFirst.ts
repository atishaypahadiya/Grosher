// The first stop's close-up, prepared while the list screen is open: when the planned route starts in a hero
// zone, after a moment and in the browser's idle periods (one step each), the 3D map's chunk and the zone's
// are fetched, the map's fixtures merged with and without the zone's (map3d/Fixtures.tsx `prepareFixtures`),
// the zone's geometry built and its textures fetched and transcoded (src/hero/bulk/HeroZone.tsx `prepare`).
// What is left for the trip is the zone's shader compile and its GPU upload, before the camera moves. A
// different first stop drops what was prepared; starting the trip keeps it, and the zone takes it. ?prepare=0
// turns it off (the measurement's baseline). Part of the main bundle: it imports the heavy parts lazily.

import { useEffect } from "react";
import type { StoreGraph } from "@grosher/core";
import { heroStopAt, loadedZones } from "./index.ts";
import { webglAvailable } from "../map3d/webgl.ts";

let preparedKey: string | null = null;
let unprepare: (() => void) | null = null;

export function usePrepareFirstStop(store: StoreGraph, categories: { id: string; locationId: string }[], firstLocationId: string | undefined, onList: boolean, repeatMeters: number) {
  useEffect(() => {
    if (!onList) return; // the trip starting keeps what was prepared
    const hero = heroStopAt(store, categories, firstLocationId);
    const key = hero ? `${store.storeId}:${hero.zone.id}` : null;
    if (preparedKey && preparedKey !== key) {
      // the route now starts elsewhere: let go of the zone prepared for the old first stop
      unprepare?.();
      preparedKey = null;
      unprepare = null;
    }
    if (!hero || key === preparedKey) return;
    if (typeof location !== "undefined" && new URLSearchParams(location.search).get("prepare") === "0") return;
    if (!webglAvailable()) return;
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void; __grosherPrepared?: string | null };
    let live = true;
    let idle = 0;
    /** the next idle period (Safari: a short timer) */
    const nextIdle = () => new Promise<void>((resolve) => (idle = w.requestIdleCallback ? w.requestIdleCallback(() => resolve(), { timeout: 3000 }) : window.setTimeout(resolve, 120)));
    const run = async () => {
      if (!live) return;
      await import("../map3d/TripMap3D.tsx"); // the trip screen's first need
      const fixtures = await import("../map3d/Fixtures.tsx");
      await nextIdle();
      if (!live) return;
      fixtures.prepareFixtures(store, repeatMeters, hero.zone.hideFixtures);
      const api = await hero.zone.prepare();
      loadedZones.set(hero.zone.id, api.default);
      await nextIdle();
      if (!live) return;
      preparedKey = key;
      unprepare = api.unprepare;
      await api.prepare(store);
      if (live) w.__grosherPrepared = key;
    };
    // a moment for the list to settle (the shopper may still be typing), then the next idle period
    const t = window.setTimeout(() => {
      idle = w.requestIdleCallback ? w.requestIdleCallback(() => void run(), { timeout: 3000 }) : window.setTimeout(() => void run(), 200);
    }, 800);
    return () => {
      live = false;
      clearTimeout(t);
      if (idle) (w.cancelIdleCallback ?? clearTimeout)(idle);
    };
  }, [store, categories, firstLocationId, onList, repeatMeters]);
}
