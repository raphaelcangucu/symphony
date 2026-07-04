import { beforeEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { listAssistantCommands } from "@/services/assistantCommands";

vi.mock("@/services/http", async () => {
  const actual = await vi.importActual<typeof import("@/services/http")>("@/services/http");
  return { ...actual, http: { get: vi.fn() } };
});

describe("assistantCommands service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists global assistant commands for the selected context", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        data: [
          {
            slug: "goal",
            name: "Goal",
            description: "Set a goal",
            kind: "builtin",
            category: "core",
            submitKind: "goal",
            source: "builtin",
          },
        ],
      },
    });

    const result = await listAssistantCommands("execution");

    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/assistant/commands?context=execution");
    expect(result).toEqual([
      {
        slug: "goal",
        name: "Goal",
        description: "Set a goal",
        kind: "builtin",
        category: "core",
        submitKind: "goal",
        source: "builtin",
      },
    ]);
  });

  it("lists project assistant commands when project slug is provided", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: [] } });

    await listAssistantCommands("execution", "macro-markets");

    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/assistant/commands?context=execution");
  });

  it("rejects blank project slug values", async () => {
    await expect(listAssistantCommands("execution", "   ")).rejects.toThrow();
  });

  it("throws when backend payload is not an array", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { invalid: true } } });

    await expect(listAssistantCommands("execution")).rejects.toThrow("assistant command list response must be an array");
  });

  it("throws when required command fields are missing", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        data: [
          {
            name: "Goal",
            description: "Set a goal",
            kind: "builtin",
            submitKind: "goal",
            source: "builtin",
          },
        ],
      },
    });

    await expect(listAssistantCommands("execution")).rejects.toThrow("assistantCommands[0].slug is required");
  });

  it("throws on invalid kind and submit kind values", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        data: [
          {
            slug: "bad",
            name: "Bad",
            description: "Invalid",
            kind: "not-valid",
            submitKind: "also-bad",
            source: "backend",
          },
        ],
      },
    });

    await expect(listAssistantCommands("execution")).rejects.toThrow("assistantCommands[0].kind must be 'builtin' or 'skill'");
  });
});
