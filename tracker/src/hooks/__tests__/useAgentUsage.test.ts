import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAgentUsage } from "@/hooks/useAgentUsage";
import * as service from "@/services/agentUsage";
import type { AgentUsageMap } from "@/types/agent-usage";

const emptyMap: AgentUsageMap = { codex: null, claude: null, cursor: null, opencode: null };

describe("useAgentUsage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads usage on mount and re-loads on refetch", async () => {
    const spy = vi.spyOn(service, "getAgentUsage").mockResolvedValue(emptyMap);

    const { result } = renderHook(() => useAgentUsage(60_000));

    await waitFor(() => expect(result.current.usage).toBe(emptyMap));
    expect(spy).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it("flags an error when the request rejects", async () => {
    vi.spyOn(service, "getAgentUsage").mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useAgentUsage(60_000));

    await waitFor(() => expect(result.current.error).toBe(true));
  });
});
