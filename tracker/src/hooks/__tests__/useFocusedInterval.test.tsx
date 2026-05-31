import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFocusedInterval } from "@/hooks/useFocusedInterval";

describe("useFocusedInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not call the callback while inactive", () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const callback = vi.fn();

    renderHook(() => useFocusedInterval(callback, 1000));

    act(() => vi.advanceTimersByTime(3000));
    expect(callback).not.toHaveBeenCalled();
  });

  it("does not call the callback while disabled", () => {
    const callback = vi.fn();

    renderHook(() => useFocusedInterval(callback, 1000, { enabled: false }));

    act(() => vi.advanceTimersByTime(3000));
    expect(callback).not.toHaveBeenCalled();
  });

  it("calls immediately and then on the interval while active", () => {
    const callback = vi.fn();

    renderHook(() => useFocusedInterval(callback, 1000));

    expect(callback).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2000));
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("fires once when transitioning from inactive to active", () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const callback = vi.fn();

    renderHook(() => useFocusedInterval(callback, 1000));
    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.mocked(document.hasFocus).mockReturnValue(true);
      window.dispatchEvent(new Event("focus"));
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("stops calling the callback after unmount", () => {
    const callback = vi.fn();

    const { unmount } = renderHook(() => useFocusedInterval(callback, 1000));
    expect(callback).toHaveBeenCalledTimes(1);

    unmount();
    act(() => vi.advanceTimersByTime(3000));
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
