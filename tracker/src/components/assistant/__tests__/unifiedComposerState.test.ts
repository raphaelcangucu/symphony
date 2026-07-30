import { describe, expect, it } from "vitest";

import { deriveUnifiedComposerState } from "@/components/assistant/unifiedComposerState";

describe("deriveUnifiedComposerState", () => {
  it("queues Enter and keeps Stop primary while a run is active", () => {
    expect(
      deriveUnifiedComposerState({
        runActive: true,
        queueingEnabled: true,
        canSteer: true,
        pending: false,
      }),
    ).toEqual({
      enterIntent: "queue",
      primaryAction: "stop",
      composerDisabled: false,
    });
  });

  it("sends and shows Send when no run is active", () => {
    expect(
      deriveUnifiedComposerState({
        runActive: false,
        queueingEnabled: true,
        canSteer: true,
        pending: false,
      }),
    ).toEqual({
      enterIntent: "send",
      primaryAction: "send",
      composerDisabled: false,
    });
  });

  it("steers directly only after queueing is explicitly disabled", () => {
    expect(
      deriveUnifiedComposerState({
        runActive: true,
        queueingEnabled: false,
        canSteer: true,
        pending: false,
      }),
    ).toMatchObject({
      enterIntent: "steer",
      primaryAction: "stop",
    });
  });

  it("blocks active non-steerable agents when queueing is disabled", () => {
    expect(
      deriveUnifiedComposerState({
        runActive: true,
        queueingEnabled: false,
        canSteer: false,
        pending: false,
      }),
    ).toEqual({
      enterIntent: "blocked",
      primaryAction: "stop",
      composerDisabled: true,
    });
  });
});
