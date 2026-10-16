import { useMemo } from "react";
import { Router, WalkGraph } from "@grosher/core";
import { demoSupercenter } from "@grosher/stores";
import { StoreMap } from "./components/StoreMap.tsx";

const { store, catalog } = demoSupercenter;

// Checkpoint build: render the demo store with a sample route so the map
// can be checked visually. The list screen replaces this.
const SAMPLE = ["bananas", "milk", "eggs", "rice", "pasta", "chips", "icecream", "bread"];

export function App() {
  const route = useMemo(() => {
    const router = new Router(new WalkGraph(store));
    const stops = SAMPLE.map((id) => catalog.find((s) => s.id === id)!);
    return router.solve({ stops });
  }, []);
  const currentNodeId = route.legs[2]?.nodeId;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Grosher</span>
        <span className="store-name">Demo Supercenter</span>
      </header>
      <StoreMap store={store} route={route} currentNodeId={currentNodeId} className="app-map" />
      <footer className="legend">
        <span><i className="sw sw-entrance" />Entrance</span>
        <span><i className="sw sw-exit" />Exit</span>
        <span><i className="sw sw-checkout" />Checkout</span>
        <span><i className="sw sw-route" />Route</span>
        <span><i className="sw sw-current" />You</span>
      </footer>
    </div>
  );
}
