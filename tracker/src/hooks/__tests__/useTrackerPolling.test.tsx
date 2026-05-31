import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTrackerPolling } from "@/hooks/useTrackerPolling";

describe("useTrackerPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not start a timer for local trackers", () => {
    const refetch = vi.fn();
    renderHook(() => useTrackerPolling({ kind: "local", refetch, intervalMs: 1000 }));
    act(() => vi.advanceTimersByTime(5000));
    expect(refetch).not.toHaveBeenCalled();
  });

  it("refetches immediately and then on the interval for remote trackers", () => {
    const refetch = vi.fn();
    renderHook(() => useTrackerPolling({ kind: "github", refetch, intervalMs: 1000 }));
    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2500));
    expect(refetch).toHaveBeenCalledTimes(3);
  });
});
