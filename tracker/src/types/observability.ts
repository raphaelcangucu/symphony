export type RuntimeStatus = "online" | "stale";

export interface RuntimeTokens {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

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
