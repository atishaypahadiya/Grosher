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

/** A shelf position: aisle + side + bay, pinned to an aisle edge at an offset from edge.from. */
export interface ShelfLocation {
  id: string;
  aisle: string; // e.g. "A12" (Walmart aisle code)
  side?: "L" | "R";
  bay?: string; // Walmart section/modular
  edgeId: string;
  offsetM: number;
}

export type ItemTag = "frozen" | "chilled" | "heavy" | "fragile" | "produce";

/** One thing on the list, resolved to one or more candidate shelf locations. */
export interface Stop {
  id: string;
  name: string;
  locationIds: string[]; // >1 => item lives in several places (endcaps, seasonal)
  tags?: ItemTag[];
  confidence?: number; // 0..1, from item resolution
}

export interface StoreGraph {
  storeId: string;
  version: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  locations: ShelfLocation[];
  entranceId: string;
  checkoutIds: string[]; // any lane; solver picks the best one
  exitId: string;
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
