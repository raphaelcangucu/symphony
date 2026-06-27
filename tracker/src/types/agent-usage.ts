import type { AgentKind } from "@/types/issue";

export type UsageWindowKind = "session" | "weekly" | "reviews" | (string & {});

export interface UsageWindow {
  kind: UsageWindowKind;
  usedPercent: number;
  resetsAt: number | null;
  windowMinutes: number | null;
}

export interface AgentUsageSnapshot {
  agentKind: string;
  plan: string | null;
  creditsRemaining: number | null;
  creditsUnlimited: boolean;
  fetchedAt: number | null;
  stale: boolean;
  windows: UsageWindow[];
  modelLimits: UsageWindow[];
}

export type AgentUsageMap = Record<AgentKind, AgentUsageSnapshot | null>;
