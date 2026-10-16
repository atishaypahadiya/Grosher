// Canonical department table (DESIGN.md §2). Each store's StoreGraph carries
// its own copy so a store can override colors or add departments.

import type { Department } from "@grosher/core";

export const DEPARTMENTS: Department[] = [
  { id: "produce", name: "Produce", color: "#6CB26A", texture: "produce.jpg" },
  { id: "dairy", name: "Dairy", color: "#F2EAD2", texture: "dairy.jpg" },
  { id: "frozen", name: "Frozen", color: "#DDEFF0", texture: "frozen.jpg" },
  { id: "bakery", name: "Bakery", color: "#E9B46A", texture: "bakery.jpg" },
  { id: "meat", name: "Meat", color: "#E5A2A0", texture: "meat.jpg" },
  { id: "dry", name: "Dry goods", color: "#E2C9A2", texture: "dry.jpg" },
  { id: "snack", name: "Snacks", color: "#F3C96B", texture: "snack.jpg" },
  { id: "drinks", name: "Drinks", color: "#8FC9E8", texture: "drinks.jpg" },
  { id: "household", name: "Household", color: "#D8D4CC", texture: "household.jpg" },
  { id: "checkout", name: "Checkout", color: "#DCE3D4" },
];

export const departmentById = (depts: Department[] | undefined, id: string | undefined): Department | undefined =>
  id === undefined ? undefined : (depts ?? DEPARTMENTS).find((d) => d.id === id);
