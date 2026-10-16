// "Preview in 3D": the trip renderer on the current draft, with a synthetic
// trip through the first few placeable catalog items.

import { lazy, Suspense, useMemo, useState } from "react";
import { Router, WalkGraph } from "@grosher/core";
import type { StoreBundle } from "@grosher/stores";
import { startTrip } from "../lib/trip.ts";
import type { Draft } from "./model.ts";
import { Ground } from "../components/Ground.tsx";
import { IconClose } from "../components/Icons.tsx";

const TripMap3D = lazy(() => import("../map3d/TripMap3D.tsx"));

export function Preview3D({ draft, bundle, textureUrls, onClose }: { draft: Draft; bundle: StoreBundle; textureUrls: Map<string, string>; onClose: () => void }) {
  const [flat, setFlat] = useState(false);
  const result = useMemo(() => {
    try {
      const router = new Router(new WalkGraph(draft.store));
      const stops = draft.catalog.filter((s) => s.locationIds.every((l) => draft.store.locations.some((x) => x.id === l))).slice(0, 6);
      if (!stops.length) return { error: "No placed items to route through yet." };
      return { trip: startTrip(router, stops) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [draft]);
  const previewBundle: StoreBundle = useMemo(
    () => ({
      ...bundle,
      store: draft.store,
      catalog: draft.catalog,
      textureUrl: (file: string) => {
        for (const [dept, url] of textureUrls) if ((draft.store.departments ?? []).find((d) => d.id === dept)?.texture === file) return url;
        return bundle.textureUrl(file);
      },
    }),
    [bundle, draft, textureUrls],
  );
  const next = result.trip?.route.legs[0];
  return (
    <div className="preview3d" role="dialog" aria-label="Preview in 3D">
      <Ground />
      <div className="preview-frame">
        {result.trip ? (
          <Suspense fallback={<p className="muted">Loading the 3D map…</p>}>
            <TripMap3D
              bundle={previewBundle}
              trip={result.trip}
              flat={flat}
              onFlatChange={setFlat}
              nextLabel={next?.stopId ? { eyebrow: `Preview · 1 of ${result.trip.original.length}`, name: next.label, distance: `${Math.round(next.distanceM)} m` } : null}
              checkoutLabel={null}
            />
          </Suspense>
        ) : (
          <p className="preview-error">{result.error}</p>
        )}
        <button type="button" className="pill circle preview-close" aria-label="Close preview" onClick={onClose}>
          <IconClose />
        </button>
        <button type="button" className="pill preview-flat" onClick={() => setFlat((f) => !f)}>
          {flat ? "Tilt" : "Flatten"}
        </button>
      </div>
    </div>
  );
}
