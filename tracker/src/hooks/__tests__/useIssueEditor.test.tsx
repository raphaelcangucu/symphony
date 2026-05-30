import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { useIssueEditor } from "@/hooks/useIssueEditor";
import * as editorService from "@/services/editor";

describe("useIssueEditor", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads an available editor target", async () => {
    vi.spyOn(editorService, "fetchEditorTarget").mockResolvedValue({
      available: true,
      url: "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1",
      reason: null,
    });

    const { result } = renderHook(() =>
      useIssueEditor({ projectSlug: "macro-markets", identifier: "MAC-1", enabled: true }),
    );

    await waitFor(() => expect(result.current.available).toBe(true));
    expect(result.current.url).toContain("?folder=");
    expect(result.current.reason).toBeNull();
  });

  it("stays inactive when disabled", async () => {
    const spy = vi.spyOn(editorService, "fetchEditorTarget");

    const { result } = renderHook(() =>
      useIssueEditor({ projectSlug: "macro-markets", identifier: "MAC-1", enabled: false }),
    );

    expect(spy).not.toHaveBeenCalled();
    expect(result.current.available).toBe(false);
    expect(result.current.url).toBeNull();
  });

  it("exposes the unavailable reason", async () => {
    vi.spyOn(editorService, "fetchEditorTarget").mockResolvedValue({
      available: false,
      url: null,
      reason: "workspace_missing",
    });

    const { result } = renderHook(() =>
      useIssueEditor({ projectSlug: "macro-markets", identifier: "MAC-1", enabled: true }),
    );

    await waitFor(() => expect(result.current.reason).toBe("workspace_missing"));
    expect(result.current.available).toBe(false);
  });
});
