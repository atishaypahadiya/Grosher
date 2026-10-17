// Trip history for one store: load once, append finished trips, newest first.

import { useCallback, useEffect, useState } from "react";
import { addRecord, loadHistory, saveHistory, type TripRecord } from "./history.ts";

export function useHistory(storeId: string) {
  const [history, setHistory] = useState<TripRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    setLoaded(false);
    loadHistory(storeId).then((h) => {
      if (!live) return;
      setHistory((cur) => cur.reduce((acc, r) => addRecord(acc, r), h));
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [storeId]);
  useEffect(() => {
    if (loaded) void saveHistory(storeId, history);
  }, [history, loaded, storeId]);
  const add = useCallback((r: TripRecord) => setHistory((cur) => addRecord(cur, r)), []);
  return { history, loaded, add };
}
