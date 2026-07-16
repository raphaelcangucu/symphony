import { describe, expect, it } from "vitest";
import { canonicalizeToolCall } from "@/lib/toolCallCanonicalize";

describe("canonicalizeToolCall family", () => {
  it("maps Bash description to command family", () => {
    const p = canonicalizeToolCall({
      name: "Bash",
      arguments: {
        description: "Run GranteeAutocomplete unit tests",
        command: "yarn test components/shared/GroupShare/GranteeAutocomplete.test.js",
      },
      status: "completed",
      output: JSON.stringify({
        success: { exitCode: 0, executionTime: 4356, stdout: "PASS\nTests: 4 passed" },
      }),
    });
    expect(p.family).toBe("command");
    expect(p.title).toBe("Run GranteeAutocomplete unit tests");
    expect(p.meta.exitCode).toBe(0);
  });

  it("resolves Cursor Mcp wrapper via toolName", () => {
    const p = canonicalizeToolCall({
      name: "Mcp",
      arguments: {
        toolName: "manage_preview",
        args: { action: "status" },
      },
      status: "completed",
      output: JSON.stringify({
        success: {
          content: [
            {
              text: {
                text: JSON.stringify({
                  data: {
                    identifier: "CDE-1180",
                    servers: [{ port: 4301, status: "starting", url: "https://example.test/" }],
                  },
                  message: "Preview status",
                  tool: "manage_preview",
                }),
              },
            },
          ],
        },
      }),
    });
    expect(p.toolName).toBe("manage_preview");
    expect(p.family).toBe("preview");
    expect(p.meta.action).toBe("status");
    expect(p.links.some((l) => l.href.includes("example.test"))).toBe(true);
  });

  it("maps kb_* to kb family", () => {
    const p = canonicalizeToolCall({
      name: "kb_create_page",
      arguments: {
        repository: "advising",
        path: "superpowers/specs/2026-07-16-cde-1180.md",
        title: "CDE-1180 design",
      },
      status: "completed",
      output: null,
    });
    expect(p.family).toBe("kb");
    expect(p.kbPath).toContain("superpowers/specs");
  });
});
