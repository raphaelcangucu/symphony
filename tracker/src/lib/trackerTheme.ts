export const TRACKER_THEME_STORAGE_KEY = "tracker-theme";

export const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export type Theme = "light" | "dark" | "system";
export type AppliedTheme = Exclude<Theme, "system">;

export function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredTheme(): Theme {
  const storage = getStorage();
  if (!storage) return "system";

  try {
    const storedTheme = storage.getItem(TRACKER_THEME_STORAGE_KEY);
    return isTheme(storedTheme) ? storedTheme : "system";
  } catch {
    return "system";
  }
}

export function writeStoredTheme(theme: Theme): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(TRACKER_THEME_STORAGE_KEY, theme);
  } catch {
    // Theme selection should never block the rest of the Tracker UI.
  }
}

export function getSystemTheme(): AppliedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia(COLOR_SCHEME_QUERY).matches ? "dark" : "light";
}

export function applyRootTheme(theme: AppliedTheme): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
}
