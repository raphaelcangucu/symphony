export type AgentExecutionStatus = "live" | "idle" | "waiting" | "retrying";

export interface AgentExecutionTokens {
  input: number;
  output: number;
  total: number;
}

export interface AgentExecution {
  issueIdentifier: string;
  status: AgentExecutionStatus;
  sessionId: string | null;
  lastEvent: string | null;
  lastMessage: string | null;
  lastEventAt: string | null;
  turnCount: number;
  runtimeSeconds: number | null;
  startedAt: string | null;
  retryAttempt: number;
  error: string | null;
  tokens: AgentExecutionTokens | null;
}
