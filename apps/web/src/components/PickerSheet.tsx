// "Tell me where" / "Pick aisle": the flat map in a sheet; tapping a shelf
// location places the item there.

import { useState } from "react";
import type { StoreGraph } from "@grosher/core";
import { nearestLocation } from "../editor/model.ts";
import { describeLocation } from "../lib/format.ts";
import { StoreMap, type Pt } from "./StoreMap.tsx";
import { IconClose } from "./Icons.tsx";

export function PickerSheet({ store, itemName, onPick, onClose }: { store: StoreGraph; itemName: string; onPick: (locationId: string) => void; onClose: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const onTap = (pt: Pt) => {
    const loc = nearestLocation(store, pt, 2.5);
    if (loc) setPicked(loc.id);
  };
  return (
    <div className="picker" role="dialog" aria-label={`Where is ${itemName}?`}>
      <div className="picker-sheet glass-deep sheet">
        <div className="picker-head">
          <div>
            <span className="eyebrow now">Tell me where</span>
            <h2 className="title">{itemName}</h2>
            <p className="muted">Tap the shelf it was on.</p>
          </div>
          <button type="button" className="pill circle" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <div className="picker-map">
          <StoreMap store={store} showLocations selection={picked ? { locationId: picked } : null} onTap={onTap} className="picker-canvas" />
        </div>
        <div className="picker-foot">
          <span className="muted">{picked ? describeLocation(store, picked) : "Nothing picked yet"}</span>
          <button type="button" className="pill lime" disabled={!picked} onClick={() => picked && onPick(picked)}>
            This shelf
          </button>
        </div>
      </div>
    </div>
  );
}
