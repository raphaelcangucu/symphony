import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMediaQuery } from "@/hooks/useMediaQuery";

type MatchMediaListener = (event: MediaQueryListEvent) => void;

let listeners: MatchMediaListener[] = [];
let currentMatches = false;

function setMatches(matches: boolean) {
  currentMatches = matches;
  listeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
}

describe("useMediaQuery", () => {
  beforeEach(() => {
    listeners = [];
    currentMatches = false;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn((query: string) => ({
        media: query,
        get matches() {
          return currentMatches;
        },
        addEventListener: (_eventName: string, listener: MatchMediaListener) => {
          listeners.push(listener);
        },
        removeEventListener: (_eventName: string, listener: MatchMediaListener) => {
          listeners = listeners.filter((current) => current !== listener);
        },
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => true,
        onchange: null,
      })),
    });
  });

  afterEach(() => {
    listeners = [];
  });

  it("rejects an empty query", () => {
    expect(() => renderHook(() => useMediaQuery(""))).toThrow(/non-empty media query/i);
  });

  it("tracks matchMedia changes", () => {
    const { result } = renderHook(() => useMediaQuery("(min-width: 1024px)"));
    expect(result.current).toBe(false);

    act(() => setMatches(true));
    expect(result.current).toBe(true);

    act(() => setMatches(false));
    expect(result.current).toBe(false);
  });
});
