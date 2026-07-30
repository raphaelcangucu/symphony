export type AssistantMessageRole = "user" | "assistant" | "tool" | "system";
export type AssistantToolStatus = "running" | "complete" | "error";

export type AssistantToolCall = {
  id: string;
  name: string;
  status: AssistantToolStatus;
  output: string | null;
};

export type AssistantMessage = {
  id: string;
  role: AssistantMessageRole;
  content: string;
  toolCalls: AssistantToolCall[];
  insertedAt: string | null;
};

export type AssistantApprovalRequest = {
  requestId: string | number;
  command: string | null;
  cwd: string | null;
  reason: string | null;
  toolName: string | null;
  agent: string | null;
};

export type AssistantQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: Array<{ label: string; description?: string }> | null;
};

export type AssistantUserInputRequest = {
  requestId: string | number;
  questions: AssistantQuestion[];
};

export type AssistantTurnStatus = {
  status: string;
  canResume: boolean;
  queuedMessages: Array<{
    id: string;
    message: string;
    provider: string | null;
  }>;
};

/** Provider-neutral interactive ceiling advertised by the Symphony host. */
export type AssistantExecutionMode = "plan" | "build" | "yolo";

export type AssistantTurnPreferences = {
  executionMode: AssistantExecutionMode | null;
  skillProfile: string | null;
  model: string | null;
  effort: string | null;
};

export type AssistantSessionMetadata = {
  projectSlug: string | null;
  issueIdentifier: string | null;
  agentKind: string | null;
  requestedModel: string | null;
  requestedEffort: string | null;
  resolvedModel: string | null;
  resolvedEffort: string | null;
};

/**
 * Native Codex and Claude goals expose richer capabilities; Cursor/OpenCode
 * can truthfully report an unavailable/unsupported goal instead of a fake one.
 */
export type AssistantGoalStatus = {
  enabled: boolean;
  available: boolean;
  status: string;
  objective: string | null;
  source: "native" | "claude" | "prompt" | "unsupported" | null;
  provider: string | null;
  capabilities: string[];
  timeUsedSeconds: number | null;
  running: boolean;
  resumable: boolean;
};

export type SessionTimelineState = {
  messages: AssistantMessage[];
  streamingText: string;
  activeTools: AssistantToolCall[];
  connectionState: "connecting" | "live" | "reconnecting" | "offline";
  pendingApproval: AssistantApprovalRequest | null;
  pendingUserInput: AssistantUserInputRequest | null;
  turnStatus: AssistantTurnStatus | null;
  turnPreferences: AssistantTurnPreferences;
  metadata: AssistantSessionMetadata;
  goal: AssistantGoalStatus | null;
  error: string | null;
};

export type SessionTimelineAction =
  | { type: "history_loaded"; messages: AssistantMessage[] }
  | { type: "history_synced"; messages: AssistantMessage[] }
  | { type: "message_created"; message: AssistantMessage }
  | { type: "assistant_delta"; delta: string }
  | { type: "tool_call_started"; toolCall: AssistantToolCall }
  | { type: "tool_call_completed"; toolCall: AssistantToolCall }
  | { type: "assistant_completed"; message: AssistantMessage }
  | { type: "approval_required"; request: AssistantApprovalRequest }
  | { type: "approval_resolved"; requestId: string | number }
  | { type: "user_input_required"; request: AssistantUserInputRequest }
  | { type: "user_input_resolved"; requestId: string | number }
  | { type: "turn_status"; status: AssistantTurnStatus }
  | { type: "turn_preferences_changed"; preferences: AssistantTurnPreferences }
  | {
      type: "session_metadata";
      metadata: Partial<AssistantSessionMetadata>;
      preferences?: AssistantTurnPreferences;
    }
  | { type: "goal_status"; goal: AssistantGoalStatus }
  | { type: "connection_changed"; state: SessionTimelineState["connectionState"] }
  | { type: "error"; message: string };

export function createSessionTimelineState(): SessionTimelineState {
  return {
    messages: [],
    streamingText: "",
    activeTools: [],
    connectionState: "connecting",
    pendingApproval: null,
    pendingUserInput: null,
    turnStatus: null,
    turnPreferences: { executionMode: null, skillProfile: null, model: null, effort: null },
    metadata: {
      projectSlug: null,
      issueIdentifier: null,
      agentKind: null,
      requestedModel: null,
      requestedEffort: null,
      resolvedModel: null,
      resolvedEffort: null,
    },
    goal: null,
    error: null,
  };
}

export function sessionTimelineReducer(
  state: SessionTimelineState,
  action: SessionTimelineAction,
): SessionTimelineState {
  switch (action.type) {
    case "history_loaded":
    case "history_synced":
      return {
        ...state,
        messages: deduplicateMessages(action.messages),
        streamingText: "",
        activeTools: [],
        connectionState: "live",
        error: null,
      };
    case "message_created":
      return {
        ...state,
        messages: upsertMessage(state.messages, action.message),
        error: null,
      };
    case "assistant_delta":
      return {
        ...state,
        streamingText: state.streamingText + action.delta,
        error: null,
      };
    case "tool_call_started":
    case "tool_call_completed":
      return {
        ...state,
        activeTools: upsertTool(state.activeTools, action.toolCall),
      };
    case "assistant_completed":
      return {
        ...state,
        messages: upsertMessage(state.messages, action.message),
        streamingText: "",
        activeTools: [],
        error: null,
      };
    case "approval_required":
      return { ...state, pendingApproval: action.request, error: null };
    case "approval_resolved":
      return {
        ...state,
        pendingApproval:
          state.pendingApproval?.requestId === action.requestId ? null : state.pendingApproval,
        error: null,
      };
    case "user_input_required":
      return { ...state, pendingUserInput: action.request, error: null };
    case "user_input_resolved":
      return {
        ...state,
        pendingUserInput:
          state.pendingUserInput?.requestId === action.requestId ? null : state.pendingUserInput,
        error: null,
      };
    case "turn_status":
      return {
        ...state,
        turnStatus: action.status,
        // A terminal turn-status event is the last event some providers emit.
        // Do not leave a stale stream looking active while waiting for a
        // best-effort history reconciliation or assistant_completed event.
        activeTools: isTerminalTurnStatus(action.status.status)
          ? settleActiveTools(state.activeTools, action.status.status)
          : state.activeTools,
      };
    case "turn_preferences_changed":
      return { ...state, turnPreferences: action.preferences };
    case "session_metadata":
      return {
        ...state,
        metadata: { ...state.metadata, ...action.metadata },
        turnPreferences: action.preferences ?? state.turnPreferences,
      };
    case "goal_status":
      return { ...state, goal: action.goal };
    case "connection_changed":
      return { ...state, connectionState: action.state };
    case "error":
      return { ...state, error: action.message };
  }
}

function deduplicateMessages(messages: AssistantMessage[]): AssistantMessage[] {
  return messages.reduce<AssistantMessage[]>(upsertMessage, []);
}

function upsertMessage(
  messages: AssistantMessage[],
  message: AssistantMessage,
): AssistantMessage[] {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index < 0) return [...messages, message];
  return messages.map((item, itemIndex) => (itemIndex === index ? message : item));
}

function upsertTool(tools: AssistantToolCall[], toolCall: AssistantToolCall): AssistantToolCall[] {
  const index = tools.findIndex((item) => item.id === toolCall.id);
  if (index < 0) return [...tools, toolCall];
  return tools.map((item, itemIndex) => (itemIndex === index ? toolCall : item));
}

function isTerminalTurnStatus(status: string): boolean {
  return !["running", "queued", "waiting", "awaiting_approval", "awaiting_input"].includes(status);
}

function settleActiveTools(tools: AssistantToolCall[], turnStatus: string): AssistantToolCall[] {
  const failed = ["failed", "error", "cancelled", "canceled"].includes(turnStatus);
  return tools.map((tool) =>
    tool.status === "running"
      ? { ...tool, status: failed ? "error" : "complete", output: tool.output ?? "" }
      : tool,
  );
}
