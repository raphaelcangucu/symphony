import { createStore } from "zustand/vanilla";
import { toast } from "sonner";

import {
  buildFloatingSurfaceId,
  type FloatingSurfaceKind,
  type FloatingSurfaceOpenInput,
} from "@/lib/floatingSurfaceIds";

export const MAX_FLOATING_SURFACES = 6;
export const DEFAULT_FLOATING_WIDTH = 720;
export const DEFAULT_FLOATING_HEIGHT = 480;
const CASCADE_OFFSET = 24;

export interface FloatingSurfaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatingSurface {
  id: string;
  kind: FloatingSurfaceKind;
  title: string;
  bounds: FloatingSurfaceBounds;
  zIndex: number;
  payload: FloatingSurfaceOpenInput;
}

interface FloatingSurfaceStoreState {
  surfaces: FloatingSurface[];
  nextZIndex: number;
}

const store = createStore<FloatingSurfaceStoreState>(() => ({
  surfaces: [],
  nextZIndex: 1,
}));

export type OpenFloatingSurfaceResult =
  | { ok: true; id: string; focusedExisting?: boolean }
  | { ok: false; reason: "max_surfaces" };

function defaultBounds(openCount: number): FloatingSurfaceBounds {
  const offset = (openCount % 6) * CASCADE_OFFSET;
  return {
    x: 64 + offset,
    y: 64 + offset,
    width: DEFAULT_FLOATING_WIDTH,
    height: DEFAULT_FLOATING_HEIGHT,
  };
}

function clampBounds(bounds: FloatingSurfaceBounds): FloatingSurfaceBounds {
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const width = Math.min(Math.max(bounds.width, 320), vw);
  const height = Math.min(Math.max(bounds.height, 240), vh);
  const x = Math.min(Math.max(bounds.x, 0), Math.max(vw - 80, 0));
  const y = Math.min(Math.max(bounds.y, 0), Math.max(vh - 80, 0));
  return { x, y, width, height };
}

export function openFloatingSurface(input: FloatingSurfaceOpenInput): OpenFloatingSurfaceResult {
  const id = buildFloatingSurfaceId(input);
  const state = store.getState();
  const existing = state.surfaces.find((surface) => surface.id === id);
  if (existing) {
    bringFloatingSurfaceToFront(id);
    return { ok: true, id, focusedExisting: true };
  }
  if (state.surfaces.length >= MAX_FLOATING_SURFACES) {
    return { ok: false, reason: "max_surfaces" };
  }

  const zIndex = state.nextZIndex;
  const surface: FloatingSurface = {
    id,
    kind: input.kind,
    title: input.title?.trim() || input.kind,
    bounds: clampBounds(defaultBounds(state.surfaces.length)),
    zIndex,
    payload: input,
  };

  store.setState({
    surfaces: [...state.surfaces, surface],
    nextZIndex: zIndex + 1,
  });
  return { ok: true, id };
}

/** Convenience: open + toast on max. Returns id or null. */
export function openFloatingSurfaceOrToast(
  input: FloatingSurfaceOpenInput,
  maxMessage: string,
): string | null {
  const result = openFloatingSurface(input);
  if (!result.ok) {
    toast.error(maxMessage);
    return null;
  }
  return result.id;
}

export function bringFloatingSurfaceToFront(id: string): void {
  store.setState((state) => {
    const index = state.surfaces.findIndex((surface) => surface.id === id);
    if (index < 0) return state;
    const zIndex = state.nextZIndex;
    const surfaces = state.surfaces.map((surface, i) =>
      i === index ? { ...surface, zIndex } : surface,
    );
    return { surfaces, nextZIndex: zIndex + 1 };
  });
}

export function closeFloatingSurface(id: string): void {
  store.setState((state) => {
    if (!state.surfaces.some((surface) => surface.id === id)) return state;
    return { surfaces: state.surfaces.filter((surface) => surface.id !== id) };
  });
}

export function updateFloatingSurfaceBounds(id: string, bounds: FloatingSurfaceBounds): void {
  const next = clampBounds(bounds);
  store.setState((state) => ({
    surfaces: state.surfaces.map((surface) =>
      surface.id === id ? { ...surface, bounds: next } : surface,
    ),
  }));
}

export function listFloatingSurfaces(): FloatingSurface[] {
  return store.getState().surfaces;
}

export function getFloatingSurfaceStore() {
  return store;
}

export function resetFloatingSurfaceStoreForTests(): void {
  store.setState({ surfaces: [], nextZIndex: 1 });
}
