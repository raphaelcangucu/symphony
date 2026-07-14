import { useEffect, useState } from "react";

/**
 * Subscribes to a CSS media query and returns whether it currently matches.
 * Returns `false` until the first client measurement (SSR-safe default).
 */
export function useMediaQuery(query: string): boolean {
  if (typeof query !== "string" || query.trim() === "") {
    throw new Error("useMediaQuery requires a non-empty media query string");
  }

  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia(query);
    const sync = () => setMatches(mediaQuery.matches);
    sync();

    mediaQuery.addEventListener("change", sync);
    return () => mediaQuery.removeEventListener("change", sync);
  }, [query]);

  return matches;
}

/** Tailwind `md` breakpoint — desktop sidebar shell is available. */
export const MD_MEDIA_QUERY = "(min-width: 768px)";

export function useIsMdUp(): boolean {
  return useMediaQuery(MD_MEDIA_QUERY);
}

/** Tailwind `lg` breakpoint — side-by-side assistant chrome is available. */
export const LG_MEDIA_QUERY = "(min-width: 1024px)";

export function useIsLgUp(): boolean {
  return useMediaQuery(LG_MEDIA_QUERY);
}
