import { afterEach, describe, expect, it, vi } from "vitest";

import { i18n } from "@/i18n";
import { fetchAssistantCodexCatalog, normalizeAssistantCodexCatalog, normalizeToolCall, sendAssistantMessage } from "@/services/assistant";
import { http } from "@/services/http";

describe("assistant service", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts project assistant messages and normalizes tool issue results", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        data: {
          assistant_message: "Created issue MAC-1: Add assistant panel",
          tool_calls: [
            {
              name: "create_issue",
              status: "complete",
              result: {
                issue: {
                  id: 1,
                  identifier: "MAC-1",
                  project_slug: "macro-markets",
                  title: "Add assistant panel",
                  status: { name: "Todo" },
                },
              },
            },
          ],
        },
      },
    });

    const response = await sendAssistantMessage("macro-markets", {
      message: "create issue: Add assistant panel",
      context: { view: "board" },
    });

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/assistant/messages", {
      message: "create issue: Add assistant panel",
      context: { view: "board" },
    });
    expect(response.assistantMessage).toBe("Created issue MAC-1: Add assistant panel");
    expect(response.toolCalls[0]).toMatchObject({
      name: "create_issue",
      status: "complete",
      result: {
        issue: {
          identifier: "MAC-1",
          title: "Add assistant panel",
          projectSlug: "macro-markets",
        },
      },
    });
  });

  it("normalizes tool call arguments and output", async () => {
    vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        data: {
          assistant_message: "done",
          tool_calls: [
            {
              name: "move_issue",
              status: "complete",
              arguments: { identifier: "MAC-1", status: "In Progress" },
              output: "Moved issue MAC-1 to In Progress.",
              result: {},
            },
          ],
        },
      },
    });

    const response = await sendAssistantMessage("macro-markets", { message: "move MAC-1" });

    expect(response.toolCalls[0].arguments).toEqual({ identifier: "MAC-1", status: "In Progress" });
    expect(response.toolCalls[0].output).toBe("Moved issue MAC-1 to In Progress.");
  });

  it("normalizes Codex CLI assistant catalog payloads", () => {
    const catalog = normalizeAssistantCodexCatalog({
      agent: "codex",
      agent_label: "Codex CLI",
      command: "codex app-server",
      default_model: "gpt-5.3-codex",
      models: [
        {
          id: "gpt-5.3-codex",
          model: "gpt-5.3-codex",
          label: "GPT-5.3 Codex",
          is_default: true,
          default_effort: "low",
          efforts: [{ id: "low", label: "Low" }],
        },
      ],
    });

    expect(catalog.agentLabel).toBe(i18n.t("assistant.catalog.agents.codex"));
    expect(catalog.models[0]?.label).toBe("GPT-5.3 Codex");
  });

  it("does not synthesize a blank effort sentinel when efforts is empty and default_effort is empty (Claude server path)", () => {
    const catalog = normalizeAssistantCodexCatalog({
      agent: "codex",
      agent_label: "Claude Code",
      command: "claude",
      default_model: "claude-opus-4-5",
      models: [
        {
          id: "claude-opus-4-5",
          model: "claude-opus-4-5",
          label: "Claude Opus 4.5",
          is_default: true,
          default_effort: "",
          efforts: [],
        },
      ],
    });

    expect(catalog.models[0]?.efforts).toEqual([]);
    expect(catalog.models[0]?.defaultEffort).toBe("");
  });

  it("synthesizes sentinel effort when efforts is empty but default_effort is non-empty (Codex fallback path)", () => {
    const catalog = normalizeAssistantCodexCatalog({
      agent: "codex",
      agent_label: "Codex CLI",
      command: "codex app-server",
      default_model: "gpt-5.3-codex",
      models: [
        {
          id: "gpt-5.3-codex",
          model: "gpt-5.3-codex",
          label: "GPT-5.3 Codex",
          is_default: true,
          default_effort: "medium",
          efforts: [],
        },
      ],
    });

    expect(catalog.models[0]?.efforts).toEqual([{ id: "medium", label: "medium" }]);
    expect(catalog.models[0]?.defaultEffort).toBe("medium");
  });

  it("loads assistant config from the tracker API", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: {
          agents: [
            {
              agent: "codex",
              agent_label: "Codex CLI",
              command: "codex app-server",
              default_model: "gpt-5.3-codex",
              models: [
                {
                  model: "gpt-5.3-codex",
                  label: "GPT-5.3 Codex",
                  is_default: true,
                  default_effort: "low",
                  efforts: [{ id: "low", label: "Low" }],
                },
              ],
            },
          ],
          default_agent: "codex",
        },
      },
    });

    const catalog = await fetchAssistantCodexCatalog("macro-markets");

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/assistant/config");
    expect(catalog.models[0]?.model).toBe("gpt-5.3-codex");
  });

  it("fails fast for blank project slugs and messages", async () => {
    await expect(sendAssistantMessage(" ", { message: "hello" })).rejects.toThrow("projectSlug is required");
    await expect(sendAssistantMessage("macro-markets", { message: " " })).rejects.toThrow("message is required");
  });
});

describe("normalizeToolCall file activity", () => {
  it("preserves apply_patch diff/counts/paths and command args over the wire", () => {
    const edit = normalizeToolCall({
      name: "apply_patch",
      status: "complete",
      arguments: { paths: ["lib/foo.ex"], file_count: 1 },
      result: { diff: "@@\n+a", additions: 1, deletions: 0, paths: ["lib/foo.ex"] },
    });
    expect(edit.name).toBe("apply_patch");
    expect(edit.result.diff).toBe("@@\n+a");
    expect(edit.result.additions).toBe(1);
    expect(edit.result.paths).toEqual(["lib/foo.ex"]);
    expect(edit.arguments).toEqual({ paths: ["lib/foo.ex"], file_count: 1 });

    const cmd = normalizeToolCall({
      name: "shell",
      status: "complete",
      arguments: { command: "mix test" },
      output: "1 passed",
      result: { exit_code: 0 },
    });
    expect(cmd.arguments).toEqual({ command: "mix test" });
    expect(cmd.output).toBe("1 passed");
    expect(cmd.result.exit_code).toBe(0);
  });
});
