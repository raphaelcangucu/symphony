import { describe, expect, it, vi } from "vitest";

import { assistantCommandsToSlashDefs } from "@/components/assistant/assistantCommandDefs";
import type { AssistantCommand } from "@/types/assistant-command";

describe("assistantCommandsToSlashDefs", () => {
  it("maps builtin commands to slash defs using submit kind", () => {
    const translate = vi.fn((key: string) => key);
    const commands: AssistantCommand[] = [
      {
        slug: "infer",
        name: "Infer",
        description: "Infer next step",
        kind: "builtin",
        category: "core",
        submitKind: "infer",
        source: "builtin",
      },
    ];

    expect(assistantCommandsToSlashDefs(commands, translate as never)).toEqual([
      {
        name: "/infer",
        kind: "infer",
        description: "Infer next step",
      },
    ]);
  });

  it("maps skill commands to message defs with directive insert text", () => {
    const translate = vi.fn((key: string, options?: Record<string, unknown>) =>
      key === "assistant.slash.skillDirective" ? `Use skill ${options?.skill as string}` : key,
    );
    const commands: AssistantCommand[] = [
      {
        slug: "plan",
        name: "Plan",
        description: "Plan the work",
        kind: "skill",
        category: "workflow",
        submitKind: null,
        source: "skills",
      },
    ];

    expect(assistantCommandsToSlashDefs(commands, translate as never)).toEqual([
      {
        name: "/plan",
        kind: "message",
        description: "Plan the work",
        insertText: "Use skill plan",
      },
    ]);
    expect(translate).toHaveBeenCalledWith("assistant.slash.skillDirective", { skill: "plan" });
  });

  it("normalizes slugs and skips blank command names", () => {
    const translate = vi.fn((key: string) => key);
    const commands: AssistantCommand[] = [
      {
        slug: " /goal ",
        name: "Goal",
        description: "Set the goal",
        kind: "builtin",
        category: "core",
        submitKind: "goal",
        source: "builtin",
      },
      {
        slug: "   ",
        name: "Invalid",
        description: "Invalid",
        kind: "builtin",
        category: "core",
        submitKind: "message",
        source: "builtin",
      },
    ];

    expect(assistantCommandsToSlashDefs(commands, translate as never)).toEqual([
      {
        name: "/goal",
        kind: "goal",
        description: "Set the goal",
      },
    ]);
  });
});
