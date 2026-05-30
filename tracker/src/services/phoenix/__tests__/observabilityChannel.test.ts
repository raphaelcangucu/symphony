import { describe, expect, it, vi } from "vitest";

import { bindObservabilityEvents, OBSERVABILITY_TOPIC } from "../observabilityChannel";

describe("observability channel binding", () => {
  it("binds runtime_updated and runtime_removed", () => {
    const handlers: Record<string, (payload: unknown) => void> = {};
    const channel = { on: (event: string, cb: (payload: unknown) => void) => (handlers[event] = cb) } as never;

    const onUpdated = vi.fn();
    const onRemoved = vi.fn();
    bindObservabilityEvents(channel, { onUpdated, onRemoved });

    handlers["runtime_updated"]({ runtime_id: "r1", label: "proj", counts: { running: 0, retrying: 0 } });
    handlers["runtime_removed"]({ runtime_id: "r1" });

    expect(OBSERVABILITY_TOPIC).toBe("observability:global");
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ runtimeId: "r1" }));
    expect(onRemoved).toHaveBeenCalledWith("r1");
  });
});
