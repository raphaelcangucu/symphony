import { beforeEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { runPromptTemplate } from "@/services/magicCommands";

describe("magicCommands service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("posts slug and overrides to run-prompt-template endpoint", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        data: {
          ok: true,
          action: "resume",
          message: "started",
          issue: {
            id: "42",
            identifier: "MAC-42",
            project_slug: "macro-markets",
            status: "Todo",
            title: "Magic command run",
            inserted_at: "2026-06-30T00:00:00Z",
          },
        },
      },
    });

    const result = await runPromptTemplate("macro-markets", "MAC-42", "code-review", {
      model: "gpt-5",
      effort: "high",
      mode: "build",
    });

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues/MAC-42/run-prompt-template", {
      slug: "code-review",
      model: "gpt-5",
      effort: "high",
      mode: "build",
    });
    expect(result).toMatchObject({
      ok: true,
      action: "resume",
      message: "started",
      issue: { identifier: "MAC-42" },
    });
  });

  it("trims identifiers and omits blank overrides", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        data: {
          ok: true,
          action: "resume",
          issue: {
            id: 1,
            identifier: "MAC-1",
            project_slug: "macro-markets",
            status: "Todo",
            title: "Trim inputs",
            inserted_at: "2026-06-30T00:00:00Z",
          },
        },
      },
    });

    await runPromptTemplate("  macro-markets  ", "  MAC-1  ", "  summarize  ", {
      model: "  ",
      effort: "   ",
    });

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues/MAC-1/run-prompt-template", {
      slug: "summarize",
    });
  });

  it("rejects blank project slug and identifier", async () => {
    await expect(runPromptTemplate("   ", "MAC-1", "code-review")).rejects.toThrow();
    await expect(runPromptTemplate("macro-markets", "   ", "code-review")).rejects.toThrow();
    await expect(runPromptTemplate("macro-markets", "MAC-1", "   ")).rejects.toThrow();
  });

  it("throws when backend response omits issue", async () => {
    vi.spyOn(http, "post").mockResolvedValueOnce({
      data: { data: { ok: true, action: "resume" } },
    });

    await expect(runPromptTemplate("macro-markets", "MAC-1", "code-review")).rejects.toThrow(
      "runPromptTemplate response missing issue",
    );
  });
});
