import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { Router, WalkGraph } from "@grosher/core";
import { demoSupercenter } from "@grosher/stores";
import { StoreMap } from "../src/components/StoreMap.tsx";

const { store, catalog } = demoSupercenter;

describe("StoreMap", () => {
  test("renders every edge, shelf location and landmark of the demo store", () => {
    const { container } = render(<StoreMap store={store} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toMatch(/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/);
    expect(svg.querySelectorAll('[data-layer="edges"] line')).toHaveLength(store.edges.length);
    expect(svg.querySelectorAll("[data-location]")).toHaveLength(store.locations.length);
    expect(svg.querySelectorAll('[data-landmark="checkout"]')).toHaveLength(store.checkoutIds.length);
    expect(svg.querySelector('[data-landmark="entrance"]')).not.toBeNull();
    expect(svg.querySelector('[data-landmark="exit"]')).not.toBeNull();
    expect(svg.querySelector('[data-layer="route"]')).toBeNull();
  });

  test("draws the route and numbered stops when given one", () => {
    const router = new Router(new WalkGraph(store));
    const route = router.solve({ stops: catalog.slice(0, 5) });
    const { container } = render(<StoreMap store={store} route={route} currentNodeId={route.legs[0].nodeId} />);
    expect(container.querySelectorAll("[data-stop]")).toHaveLength(5);
    expect(container.querySelector('[data-layer="route"] polyline')).not.toBeNull();
    expect(container.querySelector('[data-landmark="current"]')).not.toBeNull();
  });
});
