export type AgentExecutionStatus =
  | "live"
  | "idle"
  | "waiting"
  | "retrying"
  | "error"
  | "aborted"
  | "paused"
  | "saved";

export interface AgentExecutionTokens {
  input: number;
  output: number;
  total: number;
}

export type AgentExecutionGoalKind = "goal" | "workflow";
export type AgentExecutionGoalSource = "native" | "prompt";

export interface AgentExecutionGoal {
  kind: AgentExecutionGoalKind;
  source: AgentExecutionGoalSource;
  objective: string | null;
  status: string | null;
  capabilities: string[];
  tokenBudget: number | null;
  tokensUsed: number | null;
  timeUsedSeconds: number | null;
  updatedAt: number | null;
}

export interface AgentExecution {
  issueIdentifier: string;
  status: AgentExecutionStatus;
  agentKind: "codex" | "claude" | "cursor" | null;
  sessionId: string | null;
  lastEvent: string | null;
  lastMessage: string | null;
  lastEventAt: string | null;
  turnCount: number;
  runtimeSeconds: number | null;
  startedAt: string | null;
  retryAttempt: number;
  error: string | null;
  goal: AgentExecutionGoal | null;
  longRunning: boolean;
  longRunningKind: AgentExecutionGoalKind | null;
  longRunningLabel: string | null;
  tokens: AgentExecutionTokens | null;
  parentIdentifier?: string | null;
  bundleRole?: "parent" | "parent_unified" | "child" | "subagent" | "standalone";
  unitId?: string | null;
  repo?: string | null;
  childIdentifiers?: string[];
}
