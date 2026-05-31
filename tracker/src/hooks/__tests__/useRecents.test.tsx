import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRecents } from "@/hooks/useRecents";
import * as recentsService from "@/services/recents";
import type { RecentSession } from "@/types/recents";

vi.mock("@/services/recents", () => ({ listRecents: vi.fn() }));

const sample: RecentSession = {
  id: "chat:1",
  kind: "chat",
  scope: "freeform",
  projectSlug: null,
  projectName: null,
  title: "Ideas",
  identifier: null,
  threadId: 1,
  status: "Active",
  statusKind: "active",
  preview: "hi",
  updatedAt: "2026-05-30T00:00:00Z",
};

describe("useRecents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads recent sessions on mount", async () => {
    vi.mocked(recentsService.listRecents).mockResolvedValue([sample]);
    const { result } = renderHook(() => useRecents());
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    expect(result.current.sessions[0].id).toBe("chat:1");
  });

  it("keeps last known state when a later fetch fails", async () => {
    vi.mocked(recentsService.listRecents).mockResolvedValueOnce([sample]);
    const { result } = renderHook(() => useRecents());
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    vi.mocked(recentsService.listRecents).mockRejectedValueOnce(new Error("boom"));
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.sessions).toEqual([sample]);
    expect(result.current.loading).toBe(false);
  });
});
