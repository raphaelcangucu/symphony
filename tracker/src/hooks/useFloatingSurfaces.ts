import { useSyncExternalStore } from "react";

import { getFloatingSurfaceStore, type FloatingSurface } from "@/stores/floatingSurfaceStore";

export function useFloatingSurfaces(): FloatingSurface[] {
  const store = getFloatingSurfaceStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().surfaces,
    () => store.getState().surfaces,
  );
}
