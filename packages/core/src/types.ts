// Grosher routing core: shared types.
// Coordinates are local meters (x right, y down on the floor plan).

export type NodeType =
  | "entrance"
  | "exit"
  | "checkout"
  | "aisle_end"
  | "aisle_mid"
  | "junction"
  | "location"; // virtual node inserted at a shelf position

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  type: NodeType;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  lengthM?: number; // defaults to Euclidean distance
  oneWay?: boolean; // e.g. entrance turnstiles
}

export type ItemTag = "frozen" | "chilled" | "heavy" | "fragile" | "produce";

/** Walmart store zones: grocery, market/deli, general merchandise, bakery, front end. */
export type StoreZone = "GR" | "MD" | "GM" | "BK" | "FT";

/** A shelf position: aisle + side + section, pinned to an aisle edge at an offset from edge.from. */
export interface ShelfLocation {
  id: string;
  aisle: string; // e.g. "A12" (Walmart aisle code), or a wall name
  side?: "L" | "R" | "E"; // left, right, or endcap
  bay?: string; // Walmart section, e.g. "100" = endcap
  modular?: string; // Walmart modular within the section
  shelf?: number; // 0 = bottom shelf, default 2
  zone?: StoreZone;
  tags?: ItemTag[]; // what the shelf holds (chilled wall, frozen case); defaults for items placed here
  edgeId: string;
  offsetM: number;
}

/** Where a catalog entry came from. Package entries have no source. */
export type CatalogSource = "catalog" | "llm" | "memory";

/** One thing on the list, resolved to one or more candidate shelf locations. */
export interface Stop {
  id: string;
  name: string;
  locationIds: string[]; // >1 => item lives in several places (endcaps, seasonal)
  tags?: ItemTag[];
  confidence?: number; // 0..1, from item resolution
  /** other names and brands that mean this item ("toilet paper", "tide") */
  aliases?: string[];
  /** pending entries written by the resolver carry their origin */
  source?: CatalogSource;
  /** for llm-sourced pending entries: the department and sub-category guessed */
  department?: string;
  subcategory?: string;
  /** the list line as the shopper typed it, when this stop came from a list */
  query?: string;
}

/** How a department's fixtures are built in 3D. */
export type FixtureKind = "gondola" | "coldcase" | "produce" | "bakery" | "counter";

/** A physical block on the floor: shelf run, wall shelving, counter. A box in 3D, a filled polygon in 2D. */
export interface Fixture {
  id: string;
  kind: "shelf" | "wall" | "counter" | "selfcheckout" | "service" | "other";
  polygon: [number, number][]; // meters, y down, closed implicitly
  height?: number; // meters, default 1.8; counters 1.0
  department?: string; // key into departments; picks color + texture
  aisle?: string; // "A12" → aisle sign on the front face
  /** 3D geometry: bays along the run (default round(length / 1.22)) */
  bays?: number;
  /** shelf levels (default 5 gondola, 4 cold case, 3 produce / bakery) */
  shelves?: number;
  /** shelf depth from each face, metres (default half the block width) */
  depth?: number;
}

export interface Department {
  id: string;
  name: string;
  color: string; // hex, flat-map fill and the grade on the 3D texture
  texture?: string; // file name in the store's textures/ folder
  fixtureKind?: FixtureKind; // default gondola
  anchor?: [number, number]; // where the department name sits on the flat map
  angle?: number; // degrees, label rotation
}

export interface StoreGraph {
  storeId: string;
  version: number;
  name?: string; // "Walmart Supercenter"
  address?: string; // "Story Rd · San José"

  nodes: GraphNode[];
  edges: GraphEdge[];
  locations: ShelfLocation[];
  entranceId: string;
  checkoutIds: string[]; // any lane; solver picks the best one
  exitId: string;
  /** Rendering only. The solver never reads these. */
  fixtures?: Fixture[];
  departments?: Department[];
}

export interface Weights {
  /** meters of penalty per ambient stop visited after a cold stop (cold-last rule) */
  coldLast: number;
  /** meters of penalty per position a heavy item is pushed back */
  heavyEarly: number;
  /** meters of penalty per position a fragile item is pulled forward from the end */
  fragileLate: number;
  /** meters of penalty per fragile stop visited before a produce stop */
  produceBeforeFragile: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  coldLast: 60,
  heavyEarly: 4,
  fragileLate: 3,
  produceBeforeFragile: 15,
};

export interface RouteLeg {
  stopId: string | null; // null for checkout / exit legs
  label: string;
  nodeId: string;
  locationId?: string;
  path: string[]; // node ids from previous point to here (inclusive)
  distanceM: number;
}

export interface Route {
  legs: RouteLeg[];
  order: string[]; // stop ids in visit order
  distanceM: number; // walking distance only
  penaltyM: number; // constraint penalties
  costM: number; // distance + penalty, what the solver minimized
  solver: "held-karp" | "heuristic" | "empty";
  solveMs: number;
}
