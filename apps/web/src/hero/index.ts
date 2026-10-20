// Hero zones: the aisles that have a full-detail close-up. The 3D map opens one when the next stop is in it
// (or the shopper taps such a stop), lazily loading the zone's chunk and textures. Every other aisle stays
// at overview detail. The next aisle is another entry here plus its recipe (src/hero/<zone>/).

import type { StoreGraph } from "@grosher/core";
import type { ComponentType } from "react";
import type { Mesh } from "three";

export interface HeroTargetInfo {
  /** the target bin's centre (world metres) and which way it faces (z) */
  center: [number, number, number];
  facing: 1 | -1;
  name: string;
  /** how far an eye-level camera may pan along x */
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
  category: string;
  itemName: string;
  /** false while it is only being prepared in the background (the next stop's zone): no camera hand-off yet */
  active?: boolean;
  onTarget: (t: HeroTargetInfo) => void;
  onLit?: (m: Mesh | null) => void;
  onError: (e: Error) => void;
}

export interface HeroZoneEntry {
  id: string;
  storeId: string;
  /** the locations' aisle code */
  aisle: string;
  /** overview fixtures the close-up replaces (they would show through it) */
  hideFixtures: string[];
  load: () => Promise<{ default: ComponentType<HeroZoneComponentProps> }>;
  /** the same chunk's preparation: geometry and textures ahead of the trip's canvas, and its undo */
  prepare: () => Promise<{ default: ComponentType<HeroZoneComponentProps>; prepare: (store: StoreGraph) => Promise<void>; unprepare: () => void }>;
  /** the flat shelf images for devices without the 3D close-up, by category (public/hero/<id>/<category>.webp) */
  flatImage: (category: string) => string;
}

export const HERO_ZONES: HeroZoneEntry[] = [
  {
    id: "bulk",
    storeId: "grosher",
    aisle: "BULK",
    // its own three fixtures, and the ones it redraws as the backdrop seen from inside it
    hideFixtures: ["f-bulk-wall", "f-bulk-run", "f-bulk-display", "f-island3", "f-island4", "f-island7", "f-island8", "f-produce-wall", "f-run0", "f-run0-capE", "f-bws0", "f-bws0-capW", "f-bws0-capE"],
    load: () => import("./bulk/HeroZone.tsx"),
    prepare: () => import("./bulk/HeroZone.tsx"),
    flatImage: (category) => `${import.meta.env.BASE_URL}hero/bulk/${category}.webp`,
  },
];

/** zones whose module is already loaded (prepared ahead): the 3D map uses them directly, with no Suspense pass */
export const loadedZones = new Map<string, ComponentType<HeroZoneComponentProps>>();

export interface HeroStop {
  zone: HeroZoneEntry;
  category: string;
}

/** The hero zone a location is in, and its category (what the camera aims at), or null. */
export function heroStopAt(store: StoreGraph, categories: { id: string; locationId: string }[], locationId: string | undefined): HeroStop | null {
  if (!locationId) return null;
  const loc = store.locations.find((l) => l.id === locationId);
  if (!loc) return null;
  const zone = HERO_ZONES.find((z) => z.storeId === store.storeId && z.aisle === loc.aisle);
  const category = categories.find((c) => c.locationId === locationId)?.id;
  return zone && category ? { zone, category } : null;
}
