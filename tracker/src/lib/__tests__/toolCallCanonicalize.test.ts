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

  it("classifies curl+sleep health loops as preview health-wait", () => {
    const p = canonicalizeToolCall({
      name: "Bash",
      arguments: {
        description: "Wait for preview health endpoint",
        command: "for i in $(seq 1 60); do curl -sf http://127.0.0.1:4301/health && break; sleep 3; done",
      },
      status: "running",
    });
    expect(p.family).toBe("preview");
    expect(p.meta.healthWait).toBe(true);
    expect(p.title.toLowerCase()).toMatch(/health|aguard/i);
  });

  it("adds PR link badge from gh pr list stdout", () => {
    const p = canonicalizeToolCall({
      name: "Bash",
      arguments: { description: "Check if PR exists", command: "gh pr list --json number,url,state" },
      status: "completed",
      output: JSON.stringify({
        success: {
          exitCode: 0,
          stdout:
            '[{"number":9918,"state":"OPEN","url":"https://github.com/org/repo/pull/9918"}]',
        },
      }),
    });
    expect(p.links.some((l) => l.href.includes("/pull/9918"))).toBe(true);
  });

  it("marks kb_delete_folder as destructive", () => {
    const p = canonicalizeToolCall({
      name: "kb_delete_folder",
      arguments: { path: "docs/tmp", repository: "advising" },
      status: "completed",
    });
    expect(p.badges.some((b) => b.kind === "warn")).toBe(true);
  });
});

describe("canonicalizeToolCall spawn_agent", () => {
  it("maps spawn_agent to spawn_agent family", () => {
    const p = canonicalizeToolCall({
      name: "spawn_agent",
      arguments: {
        agent_type: "worker",
        message: "Review PR diffs",
      },
      status: "running",
    });
    expect(p.family).toBe("spawn_agent");
    expect(p.title).toBe("Review PR diffs");
  });

  it("attaches subagentRef on completed call with agent_id", () => {
    const p = canonicalizeToolCall({
      name: "spawn_agent",
      arguments: {
        agent_type: "worker",
        message: "Review the auth module\nInclude edge cases",
      },
      status: "completed",
      output: JSON.stringify({
        agent_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        nickname: "auth-reviewer",
      }),
    });

    expect(p.family).toBe("spawn_agent");
    expect(p.title).toBe("auth-reviewer");
    expect(p.summary).toBe("Review the auth module");
    expect(p.status).toBe("completed");
    expect(p.subagentRef).toEqual({
      resolve: "id",
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      nickname: "auth-reviewer",
      subagentType: "worker",
      taskPreview: "Review the auth module",
    });
  });

  it("omits subagentRef while running without output", () => {
    const p = canonicalizeToolCall({
      name: "spawn_agent",
      arguments: {
        agent_type: "worker",
        message: "Still starting",
      },
      status: "running",
      output: null,
    });

    expect(p.family).toBe("spawn_agent");
    expect(p.status).toBe("running");
    expect(p.subagentRef).toBeUndefined();
    expect(p.title).toBe("Still starting");
  });

  it("does not map wait or close_agent to spawn_agent", () => {
    expect(
      canonicalizeToolCall({
        name: "wait",
        arguments: { agent_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
        status: "completed",
      }).family,
    ).not.toBe("spawn_agent");

    expect(
      canonicalizeToolCall({
        name: "close_agent",
        arguments: { agent_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
        status: "completed",
      }).family,
    ).not.toBe("spawn_agent");
  });
});

