import { afterEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import {
  getAgentUsage,
  normalizeAgentUsage,
  normalizeAgentUsageMap,
} from "@/services/agentUsage";

describe("agentUsage service", () => {
  afterEach(() => vi.restoreAllMocks());

  it("normalizes a single agent snapshot from snake_case to camelCase", () => {
    const snapshot = normalizeAgentUsage({
      agent_kind: "claude",
      plan: "max",
      credits_remaining: 5,
      credits_unlimited: false,
      fetched_at: 1_900_000,
      stale: false,
      windows: [
        { kind: "session", used_percent: 42, resets_at: 1_900_000_000, window_minutes: 300 },
        { kind: "weekly", used_percent: 7.5, resets_at: 1_900_500_000, window_minutes: 10_080 },
      ],
      model_limits: [],
    });

    expect(snapshot).toEqual({
      agentKind: "claude",
      plan: "max",
      creditsRemaining: 5,
      creditsUnlimited: false,
      fetchedAt: 1_900_000,
      stale: false,
      windows: [
        { kind: "session", usedPercent: 42, resetsAt: 1_900_000_000, windowMinutes: 300 },
        { kind: "weekly", usedPercent: 7.5, resetsAt: 1_900_500_000, windowMinutes: 10_080 },
      ],
      modelLimits: [],
    });
  });

  it("returns null for an agent without a snapshot and clamps used_percent", () => {
    expect(normalizeAgentUsage(null)).toBeNull();

    const snapshot = normalizeAgentUsage({
      agent_kind: "codex",
      windows: [{ kind: "session", used_percent: 130 }],
    });
    expect(snapshot?.windows[0].usedPercent).toBe(100);
    expect(snapshot?.windows[0].resetsAt).toBeNull();
  });

  it("normalizeAgentUsageMap always has codex/claude/cursor/opencode keys", () => {
    const map = normalizeAgentUsageMap({ claude: { agent_kind: "claude", plan: "max" } });
    expect(Object.keys(map).sort()).toEqual(["claude", "codex", "cursor", "opencode"]);
    expect(map.claude?.plan).toBe("max");
    expect(map.codex).toBeNull();
    expect(map.cursor).toBeNull();
    expect(map.opencode).toBeNull();
  });

  it("getAgentUsage unwraps the envelope and normalizes", async () => {
    vi.spyOn(http, "get").mockResolvedValueOnce({
      data: { data: { claude: { agent_kind: "claude", plan: "max", windows: [] }, codex: null, cursor: null } },
    });

    const map = await getAgentUsage();
    expect(map.claude?.agentKind).toBe("claude");
    expect(map.codex).toBeNull();
  });
});
