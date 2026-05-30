import { describe, expect, it, vi } from "vitest";

import { fetchEditorTarget } from "@/services/editor";
import { http } from "@/services/http";

describe("editor service", () => {
  it("returns an available target with the editor URL", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: { data: { available: true, url: "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1" } },
    });

    const target = await fetchEditorTarget("macro-markets", "MAC-1");

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues/MAC-1/editor");
    expect(target).toEqual({ available: true, url: "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1", reason: null });
  });

  it("returns an unavailable target with a reason", async () => {
    vi.spyOn(http, "get").mockResolvedValueOnce({
      data: { data: { available: false, reason: "workspace_missing" } },
    });

    const target = await fetchEditorTarget("macro-markets", "MAC-2");

    expect(target).toEqual({ available: false, url: null, reason: "workspace_missing" });
  });

  it("validates arguments", async () => {
    await expect(fetchEditorTarget(" ", "MAC-1")).rejects.toThrow(/projectSlug/);
    await expect(fetchEditorTarget("macro-markets", " ")).rejects.toThrow(/identifier/);
  });
});
