import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { Router, WalkGraph } from "@grosher/core";
import { demoSupercenter } from "@grosher/stores";
import { StoreMap } from "../src/components/StoreMap.tsx";

const { store, catalog } = demoSupercenter;

describe("StoreMap", () => {
  test("renders every fixture, edge, shelf location and the entrance / exit of the demo store", () => {
    const { container } = render(<StoreMap store={store} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toMatch(/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/);
    expect(svg.querySelectorAll("[data-fixture]")).toHaveLength(store.fixtures!.length);
    expect(svg.querySelectorAll('[data-layer="edges"] line')).toHaveLength(store.edges.length);
    expect(svg.querySelectorAll("[data-location]")).toHaveLength(store.locations.length);
    expect(svg.querySelector('[data-landmark="entrance"]')).not.toBeNull();
    expect(svg.querySelector('[data-landmark="exit"]')).not.toBeNull();
    expect(svg.querySelector('[data-layer="route"]')).toBeNull();
    // aisle codes and wall departments are labelled
    expect(svg.querySelector('[data-label="A12"]')).not.toBeNull();
    expect(svg.querySelector('[data-label="PRODUCE"]')?.textContent).toBe("PRODUCE");
    // department fills come from the store's table
    const produce = svg.querySelector('[data-fixture="f-PRODUCE"]')!;
    expect(produce.getAttribute("fill")).toBe("#6CB26A");
  });

  test("draws the three-segment ribbon, stops, lane, next stop and you", () => {
    const router = new Router(new WalkGraph(store));
    const route = router.solve({ stops: catalog.slice(0, 5) });
    const { container } = render(
      <StoreMap store={store} route={route} currentNodeId={route.legs[0].nodeId} positionNodeId={store.entranceId} walkedPath={[store.entranceId, "VEST"]} doneNodeIds={[`loc:${catalog[0].locationIds[0]}`]} />,
    );
    expect(container.querySelectorAll("[data-stop]")).toHaveLength(5); // next stop + 4 ahead
    expect(container.querySelector('[data-layer="route"] polyline')).not.toBeNull();
    expect(container.querySelector('[data-layer="route-ahead"]')).not.toBeNull();
    expect(container.querySelector('[data-layer="route-walked"]')).not.toBeNull();
    expect(container.querySelector('[data-landmark="current"]')).not.toBeNull();
    expect(container.querySelector('[data-landmark="you"]')).not.toBeNull();
    expect(container.querySelector('[data-landmark="lane"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-done]")).toHaveLength(1);
  });

  test("editor selection and graph overlay", () => {
    const { container } = render(<StoreMap store={store} showGraph selection={{ edgeId: store.edges[0].id, locationId: store.locations[0].id, fixtureId: "f-PRODUCE" }} />);
    expect(container.querySelector('[data-layer="selection-edge"]')).not.toBeNull();
    expect(container.querySelector('[data-layer="selection-location"]')?.textContent).toMatch(/offset/);
    expect(container.querySelector('[data-fixture="f-PRODUCE"]')!.getAttribute("fill")).toBe("rgba(212,255,74,0.55)");
    expect(container.querySelectorAll("[data-node]")).toHaveLength(store.nodes.length);
  });
});
