// Canonical department table (DESIGN.md §2). Each store's StoreGraph carries
// its own copy so a store can override colors or add departments.

import type { Department } from "@grosher/core";

export const DEPARTMENTS: Department[] = [
  { id: "produce", name: "Produce", color: "#6CB26A", texture: "produce.jpg", fixtureKind: "produce" },
  { id: "dairy", name: "Dairy", color: "#F2EAD2", texture: "dairy.jpg", fixtureKind: "coldcase" },
  { id: "frozen", name: "Frozen", color: "#DDEFF0", texture: "frozen.jpg", fixtureKind: "coldcase" },
  { id: "bakery", name: "Bakery", color: "#E9B46A", texture: "bakery.jpg", fixtureKind: "bakery" },
  { id: "meat", name: "Meat", color: "#E5A2A0", texture: "meat.jpg", fixtureKind: "coldcase" },
  { id: "dry", name: "Dry goods", color: "#E2C9A2", texture: "dry.jpg", fixtureKind: "gondola" },
  { id: "snack", name: "Snacks", color: "#F3C96B", texture: "snack.jpg", fixtureKind: "gondola" },
  { id: "drinks", name: "Drinks", color: "#8FC9E8", texture: "drinks.jpg", fixtureKind: "gondola" },
  { id: "household", name: "Household", color: "#D8D4CC", texture: "household.jpg", fixtureKind: "gondola" },
  { id: "checkout", name: "Checkout", color: "#DCE3D4", fixtureKind: "counter" },
];

export const departmentById = (depts: Department[] | undefined, id: string | undefined): Department | undefined =>
  id === undefined ? undefined : (depts ?? DEPARTMENTS).find((d) => d.id === id);
