import { describe, expect, it } from "vitest";

import { resolveExecutionComposerRoute } from "@/components/assistant/executionComposerRouting";

describe("resolveExecutionComposerRoute", () => {
  it("steers when the run is steerable and the submit has content", () => {
    expect(
      resolveExecutionComposerRoute({
        canSteer: true,
        isActive: true,
        hasContent: true,
      }),
    ).toBe("steer");
  });

  it("noops empty steers", () => {
    expect(
      resolveExecutionComposerRoute({
        canSteer: true,
        isActive: true,
        hasContent: false,
      }),
    ).toBe("noop");
  });

  it("queues when the run is active but not steerable", () => {
    expect(
      resolveExecutionComposerRoute({
        canSteer: false,
        isActive: true,
        hasContent: true,
      }),
    ).toBe("queue");
  });

  it("noops empty queue attempts", () => {
    expect(
      resolveExecutionComposerRoute({
        canSteer: false,
        isActive: true,
        hasContent: false,
      }),
    ).toBe("noop");
  });

  it("resumes when the run is idle (including empty Enter)", () => {
    expect(
      resolveExecutionComposerRoute({
        canSteer: false,
        isActive: false,
        hasContent: true,
      }),
    ).toBe("resume");
    expect(
      resolveExecutionComposerRoute({
        canSteer: false,
        isActive: false,
        hasContent: false,
      }),
    ).toBe("resume");
  });

  it("noops while a dispatch is already pending", () => {
    expect(
      resolveExecutionComposerRoute({
        canSteer: false,
        isActive: false,
        hasContent: true,
        dispatchPending: true,
      }),
    ).toBe("noop");
  });
});
