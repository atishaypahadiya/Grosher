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
}

export interface HeroZoneComponentProps {
  store: StoreGraph;
  category: string;
  itemName: string;
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
  /** the flat shelf images for devices without the 3D close-up, by category (public/hero/<id>/<category>.webp) */
  flatImage: (category: string) => string;
}

export const HERO_ZONES: HeroZoneEntry[] = [
  {
    id: "bulk",
    storeId: "grosher",
    aisle: "BULK",
    hideFixtures: ["f-bulk-wall", "f-bulk-island", "f-bulk-display"],
    load: () => import("./bulk/HeroZone.tsx"),
    flatImage: (category) => `${import.meta.env.BASE_URL}hero/bulk/${category}.webp`,
  },
];

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
