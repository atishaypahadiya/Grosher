// Close-ups: every stop opens one at eye level when it is next (or the shopper taps it), lazily loading the
// zone's chunk and textures. Two qualities: a HERO zone is drawn by hand from a recipe at full detail (today
// Bulk & pulses, src/hero/bulk); every other stop gets a STANDARD zone, generated from the store data with the
// same shelf kit (src/hero/standard: its fixture face and the one across, the stop's slot lit lime). A zone
// is upgraded to hero quality by another entry in HERO_ZONES plus its recipe (src/hero/<zone>/).

import type { Category, StoreGraph } from "@grosher/core";
import type { ComponentType } from "react";
import type { Mesh } from "three";
import { standardPlan, type StandardPlan } from "./standard/plan.ts";

export interface HeroTargetInfo {
  /** the target bin's centre (world metres) and which way it faces (z) */
  center: [number, number, number];
  facing: 1 | -1;
  name: string;
  /** out of the shelf toward the shopper, world (x, z); default (0, facing) */
  out?: [number, number];
  /** along the shelf, world (x, z): the eye-level pan's direction; default (1, 0) */
  axis?: [number, number];
  /** the lit target's height: the close-up frames all of it above the bottom card */
  height?: number;
  /** metres along `axis` the shopper stands to one side of the target, looking back at it (the aisle shows) */
  side?: number;
  /** how far an eye-level camera may pan, as positions along `axis` */
  bounds: { x0: number; x1: number };
  /** where the walk in starts: eye level, outside the zone's ceiling (the descent ends there) */
  door: [number, number, number];
  /** the walk's turns on the way from the door to where the shopper stands */
  via: [number, number, number][];
  /** metres from the bin's centre to the shopper */
  stand: number;
}

export interface HeroZoneComponentProps {
  store: StoreGraph;
  /** the zone being drawn (a standard zone's entry carries its plan) */
  zone: HeroZoneEntry;
  locationId: string;
  category: string;
  itemName: string;
  /** false while it is only being prepared in the background (the next stop's zone): no camera hand-off yet */
  active?: boolean;
  /** true once the zone may go on the GPU (textures, buffers): it is open, or it opens next and the zone before
   * it has been freed. Until then it is only prepared: geometry built, textures transcoded, programs compiled.
   * Default: `active`. */
  upload?: boolean;
  onTarget: (t: HeroTargetInfo) => void;
  onLit?: (m: Mesh | null) => void;
  onError: (e: Error) => void;
}

export interface HeroZoneEntry {
  /** unique per zone: "bulk", or "std:<location>" for a standard close-up */
  id: string;
  quality: "hero" | "standard";
  /** the module that draws it: one per hero zone, one for every standard zone */
  chunk: string;
  storeId: string;
  /** the locations' aisle code (hero zones) */
  aisle?: string;
  /** a standard zone's plan (the faces it redraws, the slot) and the store's categories (what it stocks) */
  plan?: StandardPlan;
  categories?: CategoryRow[];
  /** overview fixtures the close-up replaces (they would show through it) */
  hideFixtures: string[];
  load: () => Promise<{ default: ComponentType<HeroZoneComponentProps> }>;
  /** the same chunk's preparation: geometry and textures ahead of the trip's canvas, and its undo */
  prepare: () => Promise<{ default: ComponentType<HeroZoneComponentProps>; prepare: (store: StoreGraph, zone: HeroZoneEntry) => Promise<void>; unprepare: () => void }>;
  /** the zone's ambient fill: the scene's one hemisphere light blends to it as the camera comes down (the
   * zone brings no light of its own: a light joining the scene would recompile every material in it) */
  ambient: { sky: string; ground: string; intensity: number };
  /** the flat shelf images for devices without the 3D close-up, by category (public/hero/<id>/<category>.webp);
   * a standard zone has none (without WebGL the trip's flat map already shows the slot) */
  flatImage: (category: string) => string | null;
}

export type CategoryRow = Pick<Category, "id" | "name" | "group" | "aisle" | "department" | "locationId"> & { bays?: [number, number] };

export const HERO_ZONES: HeroZoneEntry[] = [
  {
    id: "bulk",
    quality: "hero",
    chunk: "bulk",
    storeId: "grosher",
    aisle: "BULK",
    // its own three fixtures, and the ones it redraws as the backdrop seen from inside it
    hideFixtures: ["f-bulk-wall", "f-bulk-run", "f-bulk-display", "f-island3", "f-island4", "f-island7", "f-island8", "f-produce-wall", "f-run0", "f-run0-capE", "f-bws0", "f-bws0-capW", "f-bws0-capE"],
    load: () => import("./bulk/HeroZone.tsx"),
    prepare: () => import("./bulk/HeroZone.tsx"),
    // the reference's even, warm fill: most of the light; the spots are accents on top of it
    ambient: { sky: "#FFE6CC", ground: "#C29E7C", intensity: 2.5 },
    flatImage: (category) => `${import.meta.env.BASE_URL}hero/bulk/${category}.webp`,
  },
];

/** the warm, even fill of a standard close-up: the store's own light at eye level */
export const STANDARD_AMBIENT = { sky: "#FFEBD6", ground: "#B49A80", intensity: 2.3 };

/** chunks whose module is already loaded (prepared ahead): the 3D map uses them directly, with no Suspense pass */
export const loadedZones = new Map<string, ComponentType<HeroZoneComponentProps>>();

export interface HeroStop {
  zone: HeroZoneEntry;
  category: string;
  locationId: string;
}

const STANDARD = new WeakMap<StoreGraph, Map<string, HeroZoneEntry | null>>();
/** A location's standard close-up, made once per store map. */
function standardEntry(store: StoreGraph, categories: CategoryRow[], locationId: string): HeroZoneEntry | null {
  let byLoc = STANDARD.get(store);
  if (!byLoc) STANDARD.set(store, (byLoc = new Map()));
  if (byLoc.has(locationId)) return byLoc.get(locationId)!;
  const loc = store.locations.find((l) => l.id === locationId);
  const plan = loc ? standardPlan(store, loc) : null;
  const entry: HeroZoneEntry | null = plan
    ? {
        id: `std:${locationId}`,
        quality: "standard",
        chunk: "standard",
        storeId: store.storeId,
        plan,
        categories,
        hideFixtures: plan.hide,
        load: () => import("./standard/StandardZone.tsx"),
        prepare: () => import("./standard/StandardZone.tsx"),
        ambient: STANDARD_AMBIENT,
        flatImage: () => null,
      }
    : null;
  byLoc.set(locationId, entry);
  return entry;
}

/**
 * The close-up a location opens, and its category (what the camera aims at): the hero zone it is in, else its
 * standard close-up; null only for a location the map cannot place on a fixture.
 */
export function closeUpAt(store: StoreGraph, categories: CategoryRow[], locationId: string | undefined): HeroStop | null {
  if (!locationId) return null;
  const loc = store.locations.find((l) => l.id === locationId);
  if (!loc) return null;
  const category = categories.find((c) => c.locationId === locationId)?.id ?? "";
  const hero = HERO_ZONES.find((z) => z.storeId === store.storeId && z.aisle === loc.aisle);
  if (hero) return category ? { zone: hero, category, locationId } : null;
  const std = standardEntry(store, categories, locationId);
  return std ? { zone: std, category, locationId } : null;
}
