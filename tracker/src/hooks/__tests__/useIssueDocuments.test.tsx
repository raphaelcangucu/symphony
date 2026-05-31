import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useIssueDocuments } from "@/hooks/useIssueDocuments";
import * as issueDocumentsService from "@/services/issueDocuments";
import type { IssueDocumentList } from "@/types/issueDocument";

vi.mock("@/services/issueDocuments", () => ({ listIssueDocuments: vi.fn() }));

const availableDocuments: IssueDocumentList = {
  available: true,
  reason: null,
  documents: [
    {
      id: "spec",
      kind: "spec",
      path: "docs/superpowers/specs/2026-05-31-public-preview-tunnel-design.md",
      title: "Public preview tunnel design",
      updatedAt: "2026-05-31T10:00:00Z",
    },
  ],
};

const unavailableDocuments: IssueDocumentList = {
  available: false,
  reason: "No issue documents found.",
  documents: [],
};

describe("useIssueDocuments", () => {
  const listIssueDocuments = vi.mocked(issueDocumentsService.listIssueDocuments);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fetches issue documents on mount when enabled", async () => {
    listIssueDocuments.mockResolvedValueOnce(availableDocuments);

    const { result } = renderHook(() =>
      useIssueDocuments({ projectSlug: "macro-markets", identifier: "MAC-1" }),
    );

    await waitFor(() => expect(result.current.documents).toEqual(availableDocuments.documents));
    expect(listIssueDocuments).toHaveBeenCalledWith("macro-markets", "MAC-1");
    expect(result.current.available).toBe(true);
    expect(result.current.reason).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.refetch).toEqual(expect.any(Function));
  });

  it("does not fetch when disabled or missing an identifier", () => {
    const { result, rerender } = renderHook(
      ({ enabled, identifier }) =>
        useIssueDocuments({ projectSlug: "macro-markets", identifier, enabled }),
      { initialProps: { enabled: false, identifier: "MAC-1" as string | null } },
    );

    expect(listIssueDocuments).not.toHaveBeenCalled();
    expect(result.current.documents).toEqual([]);
    expect(result.current.available).toBe(false);
    expect(result.current.reason).toBeNull();
    expect(result.current.loading).toBe(false);

    rerender({ enabled: true, identifier: null });

    expect(listIssueDocuments).not.toHaveBeenCalled();
    expect(result.current.documents).toEqual([]);
    expect(result.current.available).toBe(false);
    expect(result.current.reason).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("refetches when the refresh key changes", async () => {
    listIssueDocuments
      .mockResolvedValueOnce(unavailableDocuments)
      .mockResolvedValueOnce(availableDocuments);

    const { rerender, result } = renderHook(
      ({ refreshKey }) =>
        useIssueDocuments({
          projectSlug: "macro-markets",
          identifier: "MAC-1",
          refreshKey,
        }),
      { initialProps: { refreshKey: 0 } },
    );

    await waitFor(() => expect(result.current.reason).toBe("No issue documents found."));

    rerender({ refreshKey: 1 });

    await waitFor(() => expect(result.current.documents).toEqual(availableDocuments.documents));
    expect(listIssueDocuments).toHaveBeenCalledTimes(2);
  });

  it("polls at the interval only while the window is focused", async () => {
    vi.useFakeTimers();
    listIssueDocuments
      .mockResolvedValueOnce(unavailableDocuments)
      .mockResolvedValueOnce(availableDocuments);

    const { result } = renderHook(() =>
      useIssueDocuments({
        projectSlug: "macro-markets",
        identifier: "MAC-1",
        intervalMs: 1_000,
      }),
    );

    await act(async () => {});
    expect(result.current.reason).toBe("No issue documents found.");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current.documents).toEqual(availableDocuments.documents);
    expect(listIssueDocuments).toHaveBeenCalledTimes(2);

    vi.mocked(document.hasFocus).mockReturnValue(false);
    act(() => window.dispatchEvent(new Event("blur")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(listIssueDocuments).toHaveBeenCalledTimes(2);
  });

  it("keeps last known data when a later fetch fails", async () => {
    listIssueDocuments.mockResolvedValueOnce(availableDocuments).mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() =>
      useIssueDocuments({ projectSlug: "macro-markets", identifier: "MAC-1" }),
    );

    await waitFor(() => expect(result.current.documents).toEqual(availableDocuments.documents));

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.documents).toEqual(availableDocuments.documents);
    expect(result.current.available).toBe(true);
    expect(result.current.reason).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
