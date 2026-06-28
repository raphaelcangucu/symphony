import type { AgentUsageMap, AgentUsageSnapshot, UsageWindow } from "@/types/agent-usage";
import type { AgentKind } from "@/types/issue";

import { http, trackerPath, unwrapData } from "./http";

interface BackendUsageWindowDto {
  kind?: string | null;
  used_percent?: number | null;
  resets_at?: number | null;
  window_minutes?: number | null;
}

interface BackendAgentUsageDto {
  agent_kind?: string | null;
  plan?: string | null;
  credits_remaining?: number | null;
  credits_unlimited?: boolean | null;
  fetched_at?: number | null;
  stale?: boolean | null;
  windows?: BackendUsageWindowDto[] | null;
  model_limits?: BackendUsageWindowDto[] | null;
}

type BackendUsageMapDto = Partial<Record<AgentKind, BackendAgentUsageDto | null>>;

const AGENT_KEYS: AgentKind[] = ["codex", "claude", "cursor"];

function clampPercent(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function normalizeUsageWindow(dto: BackendUsageWindowDto): UsageWindow {
  return {
    kind: dto.kind ?? "session",
    usedPercent: clampPercent(dto.used_percent),
    resetsAt: dto.resets_at ?? null,
    windowMinutes: dto.window_minutes ?? null,
  };
}

export function normalizeAgentUsage(
  dto: BackendAgentUsageDto | null | undefined,
): AgentUsageSnapshot | null {
  if (!dto) return null;

  return {
    agentKind: dto.agent_kind ?? "",
    plan: dto.plan ?? null,
    creditsRemaining: dto.credits_remaining ?? null,
    creditsUnlimited: dto.credits_unlimited ?? false,
    fetchedAt: dto.fetched_at ?? null,
    stale: dto.stale ?? false,
    windows: (dto.windows ?? []).map(normalizeUsageWindow),
    modelLimits: (dto.model_limits ?? []).map(normalizeUsageWindow),
  };
}

export function normalizeAgentUsageMap(dto: BackendUsageMapDto): AgentUsageMap {
  return AGENT_KEYS.reduce((acc, kind) => {
    acc[kind] = normalizeAgentUsage(dto[kind] ?? null);
    return acc;
  }, {} as AgentUsageMap);
}

export async function getAgentUsage(): Promise<AgentUsageMap> {
  const response = await http.get(trackerPath("/settings/agents/usage"));
  return normalizeAgentUsageMap(unwrapData<BackendUsageMapDto>(response));
}
