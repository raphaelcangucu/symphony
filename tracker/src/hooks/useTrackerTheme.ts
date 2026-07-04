import { useEffect, useState } from "react";

import {
  applyRootTheme,
  COLOR_SCHEME_QUERY,
  getSystemTheme,
  readStoredTheme,
  writeStoredTheme,
  type Theme,
} from "@/lib/trackerTheme";

interface UseTrackerThemeResult {
  theme: Theme;
  setTheme: (next: Theme) => void;
}

export function useTrackerTheme(): UseTrackerThemeResult {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());

  useEffect(() => {
    if (theme !== "system") {
      applyRootTheme(theme);
      return;
    }

    applyRootTheme(getSystemTheme());

    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY);
    const handleColorSchemeChange = (event: MediaQueryListEvent) => {
      applyRootTheme(event.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleColorSchemeChange);
    return () => mediaQuery.removeEventListener("change", handleColorSchemeChange);
  }, [theme]);

  function setTheme(next: Theme) {
    setThemeState(next);
    writeStoredTheme(next);
  }

  return { theme, setTheme };
}
