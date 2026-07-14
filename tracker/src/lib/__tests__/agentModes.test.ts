import { describe, expect, it } from "vitest";

import {
  DEFAULT_INTERACTIVE_MODE,
  DEFAULT_AUTONOMOUS_MODE,
  normalizeAgentMode,
  availableModesFor,
} from "@/lib/agentModes";
import {
  normalizeSkillProfileId,
  resolveAutoSkillProfile,
  resolveSkillProfile,
  skillProfileMeta,
} from "@/lib/skillProfiles";

describe("agentModes", () => {
  it("defaults interactive sessions to plan and autonomous to yolo", () => {
    expect(DEFAULT_INTERACTIVE_MODE).toBe("plan");
    expect(DEFAULT_AUTONOMOUS_MODE).toBe("yolo");
  });

  it("normalizes unknown modes to the interactive default", () => {
    expect(normalizeAgentMode("turbo")).toBe("plan");
    expect(normalizeAgentMode("yolo")).toBe("yolo");
  });

  it("lists plan for every agent including cursor", () => {
    expect(availableModesFor("cursor")).toEqual(["plan", "build", "yolo"]);
    expect(availableModesFor("codex")).toEqual(["plan", "build", "yolo"]);
  });
});

describe("skillProfiles", () => {
  it("maps legacy authoring/execution aliases", () => {
    expect(normalizeSkillProfileId("authoring")).toBe("planning");
    expect(normalizeSkillProfileId("execution")).toBe("implementation");
  });

  it("resolves auto profile from mode and scope", () => {
    expect(resolveAutoSkillProfile({ scope: "issue", mode: "plan" })).toBe("planning");
    expect(resolveAutoSkillProfile({ scope: "issue", mode: "build" })).toBe("implementation");
    expect(resolveAutoSkillProfile({ scope: "project_explore", mode: "plan" })).toBe("explore");
  });

  it("keeps pinned profiles when selection is not auto", () => {
    expect(
      resolveSkillProfile({ selection: "debugging", scope: "issue", mode: "yolo" }),
    ).toBe("debugging");
  });

  it("exposes planning preload skills", () => {
    expect(skillProfileMeta("planning").preload).toEqual(["brainstorming", "writing-plans"]);
  });
});
