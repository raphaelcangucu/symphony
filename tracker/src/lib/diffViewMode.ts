export type DiffViewMode = "split" | "unified";

const STORAGE_KEY = "symphony.tracker.diff.viewMode";
const DEFAULT_VIEW_MODE: DiffViewMode = "split";

export function loadDiffViewMode(): DiffViewMode {
  if (typeof window === "undefined") return DEFAULT_VIEW_MODE;
  return normalizeDiffViewMode(window.localStorage.getItem(STORAGE_KEY));
}

export function saveDiffViewMode(mode: DiffViewMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, mode);
}

export function normalizeDiffViewMode(value: unknown): DiffViewMode {
  return value === "split" || value === "unified" ? value : DEFAULT_VIEW_MODE;
}

export function diffStyleForDiffViewMode(mode: DiffViewMode): "split" | "unified" {
  return mode;
}
