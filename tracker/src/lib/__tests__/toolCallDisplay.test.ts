import { describe, expect, it } from "vitest";

import {
  enrichCursorToolPresentation,
  formatToolOutput,
  resolveCreatePlanKbPath,
  resolveSubagentTypeLabel,
  resolveToolDisplayName,
} from "@/lib/toolCallDisplay";

describe("toolCallDisplay", () => {
  it("infers Glob from a blocked glob error payload when the name is unknown", () => {
    const payload =
      '{"error":{"error":"Glob pattern \\"**/*\\" matches every file and is not allowed. Use a more specific glob or no glob."}}';

    expect(resolveToolDisplayName("unknown", payload)).toBe("Glob");
    expect(formatToolOutput(payload)).toBe(
      'Glob pattern "**/*" matches every file and is not allowed. Use a more specific glob or no glob.',
    );
  });

  it("keeps known cursor tool labels", () => {
    expect(resolveToolDisplayName("glob")).toBe("Glob");
    expect(resolveToolDisplayName("grep")).toBe("Grep");
  });
});

describe("enrichCursorToolPresentation", () => {
  it("labels Task with explore subagent and description", () => {
    const args = {
      description: "Explore frontend for GAM-20 context",
      subagentType: "explore",
      prompt: "long…",
    };
    expect(enrichCursorToolPresentation("Task", args)).toEqual({
      toolType: "Task · Explore",
      description: "Explore frontend for GAM-20 context",
      detailLanguage: "json",
      detailMarkdown: null,
      kbPath: null,
      kind: "task",
    });
  });

  it("maps unspecified subagentType to Subagent", () => {
    expect(resolveSubagentTypeLabel({ unspecified: {} })).toBe("Subagent");
    expect(resolveSubagentTypeLabel(undefined)).toBe("Subagent");
  });

  it("labels CreatePlan and extracts kb path from plan markdown", () => {
    const args = {
      name: "GAM-20 Spec Design",
      overview: "Criar a spec de design da GAM-20",
      plan: "See [spec](frontend/docs/superpowers/specs/2026-07-16-gam-20-symphony-preview-check-design.md).",
      planUri: null,
    };
    const view = enrichCursorToolPresentation("CreatePlan", args);
    expect(view.toolType).toBe("Plan · GAM-20 Spec Design");
    expect(view.description).toBe("Criar a spec de design da GAM-20");
    expect(view.kind).toBe("create_plan");
    expect(view.detailLanguage).toBe("markdown");
    expect(view.detailMarkdown).toContain("See [spec]");
    expect(view.kbPath).toBe(
      "frontend/docs/superpowers/specs/2026-07-16-gam-20-symphony-preview-check-design.md",
    );
  });

  it("prefers planUri over markdown links", () => {
    expect(
      resolveCreatePlanKbPath({
        planUri: "docs/superpowers/specs/from-uri.md",
        plan: "[x](docs/other.md)",
      }),
    ).toBe("docs/superpowers/specs/from-uri.md");
  });
});
