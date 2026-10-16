import { useEffect, useMemo, useState } from "react";
import { Router, WalkGraph, type Stop } from "@grosher/core";
import { demoSupercenter } from "@grosher/stores";
import { StoreMap } from "./components/StoreMap.tsx";
import { ListPanel, type Plan } from "./components/ListPanel.tsx";
import { load, save } from "./lib/storage.ts";

const LIST_KEY = "grosher.list";

export function App() {
  const bundle = demoSupercenter;
  const { store, catalog } = bundle;
  const router = useMemo(() => new Router(new WalkGraph(store)), [store]);

  const [text, setText] = useState<string>(() => load(LIST_KEY, ""));
  useEffect(() => save(LIST_KEY, text), [text]);

  const [plan, setPlan] = useState<Plan | null>(null);
  const onPlan = (stops: Stop[], notFound: string[]) => {
    setPlan({ stops, notFound, route: router.solve({ stops }) });
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Grosher</span>
        <span className="store-name">Demo Supercenter</span>
      </header>
      <StoreMap store={store} route={plan?.stops.length ? plan.route : null} className="app-map" />
      <ListPanel
        store={store}
        catalog={catalog}
        text={text}
        onTextChange={setText}
        plan={plan}
        onPlan={onPlan}
        onStart={() => {
          /* trip mode: next commit */
        }}
      />
    </div>
  );
}
