export type RuntimeStatus = "online" | "stale";

export interface RuntimeTokens {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type BundleRole = "parent" | "child" | "standalone";

export interface RunningSession {
  issueIdentifier: string;
  state: string | null;
  sessionId: string | null;
  turnCount: number;
  lastEvent: string | null;
  lastMessage: string | null;
  startedAt: string | null;
  lastEventAt: string | null;
  tokens: RuntimeTokens;
  parentIdentifier?: string | null;
  bundleRole?: BundleRole;
  unitId?: string | null;
  repo?: string | null;
  childIdentifiers?: string[];
}

export interface RetryEntry {
  issueIdentifier: string;
  attempt: number;
  dueAt: string | null;
  error: string | null;
}

export interface RuntimeObservability {
  runtimeId: string;
  label: string;
  projectSlug: string | null;
  trackerKind: string | null;
  agentKind: string | null;
  sourceUrl: string | null;
  status: RuntimeStatus;
  reportedAt: string;
  counts: { running: number; retrying: number };
  agentTotals: { inputTokens: number; outputTokens: number; totalTokens: number; secondsRunning: number };
  rateLimits: unknown | null;
  running: RunningSession[];
  retrying: RetryEntry[];
}

export interface GlobalRunningRow extends RunningSession {
  runtimeId: string;
  runtimeLabel: string;
  projectSlug: string | null;
}

export type PrMonitorTickStatus = "ok" | "error" | null;

export interface PrMonitorHeartbeat {
  running: boolean;
  inFlight: number;
  tickCount: number;
  lastTickStartedAt: string | null;
  lastTickFinishedAt: string | null;
  lastTickStatus: PrMonitorTickStatus;
  lastError: string | null;
  lastEvaluatedCount: number;
  intervalMs: number;
}

export interface PrMonitorEvaluation {
  projectSlug: string | null;
  issueIdentifier: string;
  prUrl: string | null;
  lastEvent: string | null;
  lastAction: string | null;
  autoReworkCount: number;
  summary: string | null;
  lastCheckedAt: string | null;
  lastActionAt: string | null;
}

export interface PrMonitorObservability {
  heartbeat: PrMonitorHeartbeat;
  evaluations: PrMonitorEvaluation[];
}
