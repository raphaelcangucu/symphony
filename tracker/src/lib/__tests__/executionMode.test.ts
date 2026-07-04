import { describe, expect, it } from "vitest";

import {
  availableModesFor,
  cycleMode,
  DEFAULT_EXECUTION_MODE,
  EXECUTION_MODES,
  executionModeMeta,
} from "@/lib/executionMode";

describe("executionMode", () => {
  it("defines an icon + label/description key for every mode", () => {
    expect(EXECUTION_MODES.map((m) => m.id)).toEqual(["plan", "build", "yolo"]);
    for (const mode of EXECUTION_MODES) {
      expect(mode.labelKey).toMatch(/executionMode\./);
      expect(mode.descKey).toMatch(/executionMode\./);
      expect(typeof mode.Icon).toBe("object");
    }
  });

  it("defaults to build", () => {
    expect(DEFAULT_EXECUTION_MODE).toBe("build");
  });

  it("exposes all modes for codex/claude but hides plan for cursor", () => {
    expect(availableModesFor("codex")).toEqual(["plan", "build", "yolo"]);
    expect(availableModesFor("claude")).toEqual(["plan", "build", "yolo"]);
    expect(availableModesFor("cursor")).toEqual(["build", "yolo"]);
  });

  it("cycles to the next available mode and wraps around", () => {
    const all = availableModesFor("codex");
    expect(cycleMode("plan", all)).toBe("build");
    expect(cycleMode("build", all)).toBe("yolo");
    expect(cycleMode("yolo", all)).toBe("plan");
  });

  it("cycles within the agent's available set (cursor skips plan)", () => {
    const cursor = availableModesFor("cursor");
    expect(cycleMode("build", cursor)).toBe("yolo");
    expect(cycleMode("yolo", cursor)).toBe("build");
  });

  it("returns the first available mode when current is unavailable", () => {
    expect(cycleMode("plan", availableModesFor("cursor"))).toBe("build");
  });

  it("looks up metadata by id and falls back to build", () => {
    expect(executionModeMeta("yolo").id).toBe("yolo");
    expect(executionModeMeta("build").id).toBe("build");
  });
});
