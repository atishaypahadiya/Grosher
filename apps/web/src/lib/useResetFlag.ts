import { useCallback, useState } from "react";
import { loadResetState, resetVisible, saveResetState, type ResetFlag, type ResetState } from "./reset.ts";

/** The "possibly reset" flag for a store: raised after a trip, dismissed until the next flagged trip. */
export function useResetFlag(storeId: string) {
  const [state, setState] = useState<ResetState>(() => loadResetState(storeId));
  const update = useCallback(
    (next: ResetState) => {
      setState(next);
      saveResetState(storeId, next);
    },
    [storeId],
  );
  const raise = useCallback((flag: ResetFlag) => update({ flag, dismissedId: state.dismissedId === flag.id ? flag.id : null }), [update, state.dismissedId]);
  const dismiss = useCallback(() => state.flag && update({ ...state, dismissedId: state.flag.id }), [update, state]);
  return { flag: state.flag, visible: resetVisible(state), raise, dismiss };
}
