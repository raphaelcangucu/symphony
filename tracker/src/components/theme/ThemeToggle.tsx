import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const TRACKER_THEME_STORAGE_KEY = "tracker-theme";

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

type Theme = "light" | "dark" | "system";
type AppliedTheme = Exclude<Theme, "system">;

function isTheme(value: string | null): value is Theme {
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

function readStoredTheme(): Theme {
  const storage = getStorage();
  if (!storage) return "system";

  try {
    const storedTheme = storage.getItem(TRACKER_THEME_STORAGE_KEY);
    return isTheme(storedTheme) ? storedTheme : "system";
  } catch {
    return "system";
  }
}

function writeStoredTheme(theme: Theme) {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(TRACKER_THEME_STORAGE_KEY, theme);
  } catch {
    // Theme selection should never block the rest of the Tracker UI.
  }
}

function getSystemTheme(): AppliedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia(COLOR_SCHEME_QUERY).matches ? "dark" : "light";
}

function applyRootTheme(theme: AppliedTheme) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
}

export function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());

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

  function handleThemeChange(nextTheme: Theme) {
    setTheme(nextTheme);
    writeStoredTheme(nextTheme);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="relative shrink-0" aria-label={t("nav.theme.toggleAria")}>
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleThemeChange("light")}>
          <Sun className="mr-2 h-4 w-4" />
          {t("nav.theme.light")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleThemeChange("dark")}>
          <Moon className="mr-2 h-4 w-4" />
          {t("nav.theme.dark")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleThemeChange("system")}>
          <Monitor className="mr-2 h-4 w-4" />
          {t("nav.theme.system")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
