import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTrackerPolling } from "@/hooks/useTrackerPolling";

describe("useTrackerPolling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not start a timer for local trackers", () => {
    const refetch = vi.fn();
    renderHook(() => useTrackerPolling({ kind: "local", refetch, intervalMs: 1000 }));
    act(() => vi.advanceTimersByTime(5000));
    expect(refetch).not.toHaveBeenCalled();
  });

  it("polls remote trackers on the interval", () => {
    const refetch = vi.fn();
    renderHook(() => useTrackerPolling({ kind: "github", refetch, intervalMs: 1000 }));
    act(() => vi.advanceTimersByTime(2500));
    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
