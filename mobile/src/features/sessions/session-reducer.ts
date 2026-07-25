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
};

export type SessionTimelineState = {
  messages: AssistantMessage[];
  streamingText: string;
  activeTools: AssistantToolCall[];
  connectionState: "connecting" | "live" | "reconnecting" | "offline";
  pendingApproval: AssistantApprovalRequest | null;
  pendingUserInput: AssistantUserInputRequest | null;
  turnStatus: AssistantTurnStatus | null;
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
      return { ...state, turnStatus: action.status };
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
