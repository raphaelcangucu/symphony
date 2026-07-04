import { beforeEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { listPromptTemplates } from "@/services/promptTemplates";

vi.mock("@/services/http", async () => {
  const actual = await vi.importActual<typeof import("@/services/http")>("@/services/http");
  return { ...actual, http: { get: vi.fn() } };
});

describe("prompt templates service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists global prompt templates", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        data: [
          {
            id: 1,
            slug: "code-review",
            name: "Code review",
            body: "Review",
            scope: "global",
            builtIn: true,
            enabled: true,
            position: 20,
          },
        ],
      },
    });

    const result = await listPromptTemplates();

    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/prompt-templates");
    expect(result).toEqual([
      expect.objectContaining({
        id: "1",
        slug: "code-review",
        name: "Code review",
        scope: "global",
        builtIn: true,
        enabled: true,
        position: 20,
      }),
    ]);
  });

  it("lists project prompt templates when project slug is provided", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: [] } });

    await listPromptTemplates("macro-markets");

    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/prompt-templates");
  });

  it("rejects blank project slug values", async () => {
    await expect(listPromptTemplates("   ")).rejects.toThrow();
  });

  it("throws when backend payload is not an array", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { invalid: true } } });

    await expect(listPromptTemplates()).rejects.toThrow("prompt template list response must be an array");
  });

  it("throws when required template fields are missing", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: [{ id: 1, name: "Missing slug", body: "noop", scope: "global" }] },
    });

    await expect(listPromptTemplates()).rejects.toThrow("promptTemplates[0].slug is required");
  });
});
