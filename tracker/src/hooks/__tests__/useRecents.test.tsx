import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRecents } from "@/hooks/useRecents";
import type { RecentSession } from "@/types/recents";

const { useRecentsContext } = vi.hoisted(() => ({ useRecentsContext: vi.fn() }));

vi.mock("@/hooks/RecentsProvider", () => ({ useRecentsContext }));

const sample: RecentSession = {
  id: "chat:1",
  kind: "chat",
  scope: "freeform",
  agentKind: null,
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
    useRecentsContext.mockReturnValue({ sessions: [sample], loading: false });
  });

  it("reads the shared provider snapshot", () => {
    const { result } = renderHook(() => useRecents({ intervalMs: 8_000, limit: 100 }));

    expect(result.current.sessions[0].id).toBe("chat:1");
    expect(result.current.loading).toBe(false);
    expect(useRecentsContext).toHaveBeenCalledOnce();
  });

  it("keeps the legacy refetch API as a no-op", async () => {
    const { result } = renderHook(() => useRecents());

    await expect(result.current.refetch()).resolves.toBeUndefined();
    expect(useRecentsContext).toHaveBeenCalledOnce();
  });
});
