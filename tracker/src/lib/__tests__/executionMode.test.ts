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

  it("defaults to yolo (non-interactive runs cannot approve mid-run)", () => {
    expect(DEFAULT_EXECUTION_MODE).toBe("yolo");
  });

  it("exposes all modes for every agent kind", () => {
    expect(availableModesFor("codex")).toEqual(["plan", "build", "yolo"]);
    expect(availableModesFor("claude")).toEqual(["plan", "build", "yolo"]);
    expect(availableModesFor("cursor")).toEqual(["plan", "build", "yolo"]);
    expect(availableModesFor("opencode")).toEqual(["plan", "build", "yolo"]);
  });

  it("cycles to the next available mode and wraps around", () => {
    const all = availableModesFor("codex");
    expect(cycleMode("plan", all)).toBe("build");
    expect(cycleMode("build", all)).toBe("yolo");
    expect(cycleMode("yolo", all)).toBe("plan");
  });

  it("cycles within the agent's available set", () => {
    const cursor = availableModesFor("cursor");
    expect(cycleMode("build", cursor)).toBe("yolo");
    expect(cycleMode("yolo", cursor)).toBe("plan");
    expect(cycleMode("plan", cursor)).toBe("build");
  });

  it("returns the first available mode when current is unavailable", () => {
    expect(cycleMode("build", ["yolo", "plan"])).toBe("yolo");
  });

  it("looks up metadata by id and falls back to the default mode", () => {
    expect(executionModeMeta("yolo").id).toBe("yolo");
    expect(executionModeMeta("build").id).toBe("build");
    expect(executionModeMeta("bogus" as never).id).toBe(DEFAULT_EXECUTION_MODE);
  });
});
