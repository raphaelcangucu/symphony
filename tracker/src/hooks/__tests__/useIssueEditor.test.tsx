import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { useIssueEditor } from "@/hooks/useIssueEditor";
import * as editorService from "@/services/editor";

describe("useIssueEditor", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads an available browser editor target", async () => {
    vi.spyOn(editorService, "fetchEditorTargets").mockResolvedValue({
      browser: {
        available: true,
        url: "http://127.0.0.1:4002/?folder=%2Ftmp%2FMAC-1",
        reason: null,
      },
      cursorDesktop: { available: false, url: null, reason: "workspace_missing" },
    });

    const { result } = renderHook(() =>
      useIssueEditor({ projectSlug: "macro-markets", identifier: "MAC-1", enabled: true }),
    );

    await waitFor(() => expect(result.current.browser.available).toBe(true));
    expect(result.current.browser.url).toContain("?folder=");
    expect(result.current.browser.reason).toBeNull();
  });

  it("stays inactive when disabled", async () => {
    const spy = vi.spyOn(editorService, "fetchEditorTargets");

    const { result } = renderHook(() =>
      useIssueEditor({ projectSlug: "macro-markets", identifier: "MAC-1", enabled: false }),
    );

    expect(spy).not.toHaveBeenCalled();
    expect(result.current.browser.available).toBe(false);
    expect(result.current.browser.url).toBeNull();
  });

  it("exposes the unavailable browser reason", async () => {
    vi.spyOn(editorService, "fetchEditorTargets").mockResolvedValue({
      browser: { available: false, url: null, reason: "workspace_missing" },
      cursorDesktop: { available: false, url: null, reason: "workspace_missing" },
    });

    const { result } = renderHook(() =>
      useIssueEditor({ projectSlug: "macro-markets", identifier: "MAC-1", enabled: true }),
    );

    await waitFor(() => expect(result.current.browser.reason).toBe("workspace_missing"));
    expect(result.current.browser.available).toBe(false);
  });
});
