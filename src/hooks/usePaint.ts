// usePaint — reactive subscription to PaintStore + PaintHistory for React UI.

import { useSyncExternalStore } from "react";
import { PaintStore, PaintHistory, subscribeHistory } from "@/lib/omnipoint/PaintStore";

export function usePaint() {
  return useSyncExternalStore(PaintStore.subscribe, PaintStore.get, PaintStore.get);
}

export function usePaintHistory() {
  return useSyncExternalStore(
    subscribeHistory,
    () => ({ canUndo: PaintHistory.canUndo(), canRedo: PaintHistory.canRedo() }),
    () => ({ canUndo: false, canRedo: false }),
  );
}
