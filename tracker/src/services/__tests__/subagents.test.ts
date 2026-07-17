import { afterEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { listSubagents, normalizeSubagent } from "@/services/subagents";

describe("subagents service", () => {
  afterEach(() => vi.restoreAllMocks());

  it("normalizes snake_case backend entries", () => {
    expect(
      normalizeSubagent({
        id: "a0b70422f9f999605",
        agent_kind: "claude",
        label: "Extract signatures",
        nickname: null,
        role: "Explore",
        tool_use_id: "toolu_abc",
      }),
    ).toEqual({
      id: "a0b70422f9f999605",
      agentKind: "claude",
      label: "Extract signatures",
      nickname: null,
      role: "Explore",
      toolUseId: "toolu_abc",
    });
  });

  it("builds the REST URL with query params and maps the response", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        subagents: [
          {
            id: "child-1",
            agent_kind: "cursor",
            label: "Implement feature",
            nickname: "worker",
            role: "generalPurpose",
            tool_use_id: null,
          },
        ],
      },
    });

    const result = await listSubagents("advising", 42, {
      agentKind: "cursor",
      matchPrompt: "Implement feature",
    });

    expect(get).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/advising/workspaces/42/subagents?agent_kind=cursor&match_prompt=Implement+feature",
    );
    expect(result).toEqual([
      {
        id: "child-1",
        agentKind: "cursor",
        label: "Implement feature",
        nickname: "worker",
        role: "generalPurpose",
        toolUseId: null,
      },
    ]);
  });

  it("includes tool_use_id when filtering Claude children", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: { subagents: [] } });

    await listSubagents("advising", 7, { agentKind: "claude", toolUseId: "toolu_xyz" });

    expect(get).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/advising/workspaces/7/subagents?agent_kind=claude&tool_use_id=toolu_xyz",
    );
  });
});
