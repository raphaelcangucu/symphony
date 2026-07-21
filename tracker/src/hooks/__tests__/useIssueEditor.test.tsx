import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { clearIssueEditorTargetCache, useIssueEditor } from "@/hooks/useIssueEditor";
import * as editorService from "@/services/editor";

describe("useIssueEditor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearIssueEditorTargetCache();
  });

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

  it("prefers the thread editor target when threadId is set", async () => {
    const issueSpy = vi.spyOn(editorService, "fetchEditorTargets");
    const threadSpy = vi.spyOn(editorService, "fetchThreadEditorTargets").mockResolvedValue({
      browser: {
        available: true,
        url: "https://editor.example.com/?folder=%2Ftmp%2Fthread-42",
        reason: null,
      },
      cursorDesktop: {
        available: true,
        url: "cursor://file//tmp/thread-42",
        reason: null,
      },
    });

    const { result } = renderHook(() =>
      useIssueEditor({
        projectSlug: "macro-markets",
        identifier: "MAC-1",
        threadId: 42,
        enabled: true,
      }),
    );

    await waitFor(() => expect(result.current.browser.available).toBe(true));
    expect(threadSpy).toHaveBeenCalledWith(42);
    expect(issueSpy).not.toHaveBeenCalled();
    expect(result.current.cursorDesktop.url).toBe("cursor://file//tmp/thread-42");
  });
});
