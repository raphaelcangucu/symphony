import { afterEach, describe, expect, it, vi } from "vitest";

import { i18n } from "@/i18n";
import {
  fetchAssistantCatalogBundle,
  fetchAssistantCodexCatalog,
  normalizeAssistantChatMessage,
  normalizeAssistantCodexCatalog,
  normalizeToolCall,
  sendAssistantMessage,
} from "@/services/assistant";
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

  it("rejects a default effort missing from the canonical effort options", () => {
    expect(() =>
      normalizeAssistantCodexCatalog({
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
      }),
    ).toThrow("default effort");
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

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/assistant/config", {
      signal: undefined,
    });
    expect(catalog.models[0]?.model).toBe("gpt-5.3-codex");
  });

  it("loads the live global catalog for sessions without a project", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: {
          agents: [
            {
              agent: "codex",
              agent_label: "Codex CLI",
              command: "codex app-server",
              default_model: "gpt-5.6-sol",
              models: [
                {
                  model: "gpt-5.6-sol",
                  label: "GPT-5.6 Sol",
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

    const bundle = await fetchAssistantCatalogBundle();

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/assistant/config", {
      signal: undefined,
    });
    expect(bundle.agents[0]?.models[0]?.model).toBe("gpt-5.6-sol");
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

describe("normalizeToolCall id", () => {
  it("reads a string id", () => {
    expect(normalizeToolCall({ name: "read_file", id: "call_1" }).id).toBe("call_1");
  });

  it("falls back to call_id then tool_use_id", () => {
    expect(normalizeToolCall({ name: "shell", call_id: "c2" }).id).toBe("c2");
    expect(normalizeToolCall({ name: "shell", tool_use_id: "tu3" }).id).toBe("tu3");
  });

  it.each([
    ["an empty id", { name: "shell", id: "", call_id: "c2" }, "c2"],
    ["a whitespace id and NaN call_id", { name: "shell", id: " \t", call_id: Number.NaN, tool_use_id: "tu3" }, "tu3"],
    [
      "wrong-type and non-finite candidates",
      { name: "shell", id: false as unknown as string, call_id: Number.POSITIVE_INFINITY, tool_use_id: "tu4" },
      "tu4",
    ],
    [
      "invalid candidates before tool_use_id",
      { name: "shell", id: "", call_id: " ", tool_use_id: "tu5" },
      "tu5",
    ],
  ])("skips %s and uses the next valid alias", (_description, dto, expected) => {
    expect(normalizeToolCall(dto).id).toBe(expected);
  });

  it("uses the first valid alias in priority order", () => {
    expect(
      normalizeToolCall({
        name: "shell",
        id: "primary",
        call_id: "snake-call",
        tool_use_id: "snake-tool",
      }).id,
    ).toBe("primary");
  });

  it("coerces a numeric id to string", () => {
    expect(normalizeToolCall({ name: "shell", id: 7 }).id).toBe("7");
  });

  it("is null when no id is present", () => {
    expect(normalizeToolCall({ name: "shell" }).id).toBeNull();
  });
});

describe("normalizeAssistantChatMessage content blocks", () => {
  it("normalizes snake-case top-level blocks", () => {
    const snakeDto = {
      id: "snake",
      content_blocks: [
        { type: "text", text: "Snake" },
        { type: "tool", tool_call_id: "snake-tool" },
      ],
    };

    expect(normalizeAssistantChatMessage(snakeDto).contentBlocks).toEqual([
      { type: "text", text: "Snake" },
      { type: "tool", toolCallId: "snake-tool" },
    ]);
  });

  it("falls back to snake-case metadata blocks only when top-level keys are absent", () => {
    const snakeDto = {
      id: "snake-metadata",
      metadata: { content_blocks: [{ type: "tool", tool_call_id: "metadata-tool" }] },
    };

    expect(normalizeAssistantChatMessage(snakeDto).contentBlocks).toEqual([
      { type: "tool", toolCallId: "metadata-tool" },
    ]);
  });

  it("treats an explicit empty top-level array as authoritative over mismatched metadata", () => {
    const dto = {
      id: "empty-top-level",
      content: "Server-approved content",
      content_blocks: [],
      metadata: {
        content_blocks: [
          { type: "text", text: "Stale metadata content" },
          { type: "tool", tool_call_id: "unmatched-tool" },
        ],
      },
    };

    expect(normalizeAssistantChatMessage(dto).contentBlocks).toBeUndefined();
  });

  it("does not resurrect metadata when top-level blocks are malformed", () => {
    const dto = {
      id: "invalid-top-level",
      content_blocks: "not-an-array",
      metadata: { content_blocks: [{ type: "text", text: "Fallback" }] },
    };

    expect(normalizeAssistantChatMessage(dto).contentBlocks).toBeUndefined();
  });

  it("treats a present top-level field as authoritative over metadata fields", () => {
    const dto = {
      id: "top-level-precedence",
      content_blocks: [],
      metadata: { content_blocks: [{ type: "text", text: "Metadata" }] },
    };

    expect(normalizeAssistantChatMessage(dto).contentBlocks).toBeUndefined();
  });

  it("discards malformed rows and returns undefined when none remain", () => {
    const malformedRows = [
      null,
      "text",
      {},
      { type: "unknown", text: "Unknown" },
      { type: "text", text: "" },
      { type: "text", text: 7 },
      { type: "tool", tool_call_id: " \t" },
      { type: "tool", tool_call_id: 7 },
    ];
    const withValidRow = { id: "some-valid", content_blocks: [...malformedRows, { type: "text", text: "Valid" }] };
    const withoutValidRows = { id: "none-valid", content_blocks: malformedRows };

    expect(normalizeAssistantChatMessage(withValidRow).contentBlocks).toEqual([{ type: "text", text: "Valid" }]);
    expect(normalizeAssistantChatMessage(withoutValidRows).contentBlocks).toBeUndefined();
  });

  it("merges adjacent text and deduplicates tool IDs at their first position", () => {
    const dto = {
      id: "merged",
      content_blocks: [
        { type: "text", text: "A" },
        { type: "text", text: "B" },
        { type: "tool", tool_call_id: "tool-1" },
        { type: "tool", tool_call_id: "tool-1" },
        { type: "text", text: "C" },
        { type: "text", text: "D" },
      ],
    };

    expect(normalizeAssistantChatMessage(dto).contentBlocks).toEqual([
      { type: "text", text: "AB" },
      { type: "tool", toolCallId: "tool-1" },
      { type: "text", text: "CD" },
    ]);
  });

  it("preserves non-empty whitespace text", () => {
    const dto = { id: "whitespace", content_blocks: [{ type: "text", text: " \t" }] };

    expect(normalizeAssistantChatMessage(dto).contentBlocks).toEqual([{ type: "text", text: " \t" }]);
  });

  it("does not mutate DTO or metadata block data", () => {
    const topLevelBlock = Object.freeze({ type: "text", text: "Top level" });
    const topLevelBlocks = Object.freeze([topLevelBlock]);
    const topLevelDto = Object.freeze({ id: "immutable-top-level", content_blocks: topLevelBlocks });
    const metadataBlock = Object.freeze({ type: "text", text: "Metadata" });
    const metadataBlocks = Object.freeze([metadataBlock]);
    const metadata = Object.freeze({ content_blocks: metadataBlocks });
    const metadataDto = Object.freeze({ id: "immutable-metadata", metadata });

    const normalizedTopLevel = normalizeAssistantChatMessage(topLevelDto);
    const normalizedMetadata = normalizeAssistantChatMessage(metadataDto);

    expect(topLevelDto.content_blocks).toEqual([{ type: "text", text: "Top level" }]);
    expect(metadataDto.metadata).toEqual({ content_blocks: [{ type: "text", text: "Metadata" }] });
    expect(normalizedTopLevel.contentBlocks).toEqual([{ type: "text", text: "Top level" }]);
    expect(normalizedTopLevel.contentBlocks).not.toBe(topLevelBlocks);
    expect(normalizedTopLevel.contentBlocks?.[0]).not.toBe(topLevelBlock);
    expect(normalizedMetadata.contentBlocks).toEqual([{ type: "text", text: "Metadata" }]);
    expect(normalizedMetadata.contentBlocks).not.toBe(metadataBlocks);
    expect(normalizedMetadata.contentBlocks?.[0]).not.toBe(metadataBlock);
  });
});
