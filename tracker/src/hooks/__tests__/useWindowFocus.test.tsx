import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWindowFocus } from "@/hooks/useWindowFocus";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

describe("useWindowFocus", () => {
  beforeEach(() => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    setVisibility("visible");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setVisibility("visible");
  });

  it("is active when focused and visible", () => {
    const { result } = renderHook(() => useWindowFocus());
    expect(result.current).toBe(true);
  });

  it("is inactive after a blur", () => {
    const { result } = renderHook(() => useWindowFocus());
    expect(result.current).toBe(true);

    act(() => {
      vi.mocked(document.hasFocus).mockReturnValue(false);
      window.dispatchEvent(new Event("blur"));
    });

    expect(result.current).toBe(false);
  });

  it("is inactive when the document is hidden", () => {
    setVisibility("hidden");
    const { result } = renderHook(() => useWindowFocus());
    expect(result.current).toBe(false);

    act(() => {
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current).toBe(true);
  });

  it("re-activates on focus after losing focus", () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const { result } = renderHook(() => useWindowFocus());
    expect(result.current).toBe(false);

    act(() => {
      vi.mocked(document.hasFocus).mockReturnValue(true);
      window.dispatchEvent(new Event("focus"));
    });

    expect(result.current).toBe(true);
  });
});
