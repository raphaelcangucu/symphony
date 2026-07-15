import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeWorkspaceInventory } from "@/services/worktrees";

describe("subscribeWorkspaceInventory", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("closes EventSource and calls onError only once", () => {
    const close = vi.fn();
    const capture: { handler: (() => void) | null } = { handler: null };
    class FakeEventSource {
      addEventListener = vi.fn();
      close = close;
      set onerror(handler: (() => void) | null) {
        capture.handler = handler;
      }
    }
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const onError = vi.fn();
    subscribeWorkspaceInventory("advising", {
      onEntry: vi.fn(),
      onTotals: vi.fn(),
      onError,
    });
    expect(capture.handler).toEqual(expect.any(Function));
    capture.handler!();
    capture.handler!();
    expect(close).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
