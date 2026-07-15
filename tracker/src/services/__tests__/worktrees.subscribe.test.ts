import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeWorkspaceInventory } from "@/services/worktrees";

describe("subscribeWorkspaceInventory", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("closes EventSource and calls onError only once", () => {
    const close = vi.fn();
    let onerror: (() => void) | null = null;
    class FakeEventSource {
      addEventListener = vi.fn();
      close = close;
      set onerror(handler: (() => void) | null) {
        onerror = handler;
      }
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    const onError = vi.fn();
    subscribeWorkspaceInventory("advising", {
      onEntry: vi.fn(),
      onTotals: vi.fn(),
      onError,
    });
    onerror?.();
    onerror?.();
    expect(close).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
