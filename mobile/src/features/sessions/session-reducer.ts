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

export type SessionTimelineState = {
  messages: AssistantMessage[];
  streamingText: string;
  activeTools: AssistantToolCall[];
  connectionState: "connecting" | "live" | "reconnecting" | "offline";
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
  | { type: "connection_changed"; state: SessionTimelineState["connectionState"] }
  | { type: "error"; message: string };

export function createSessionTimelineState(): SessionTimelineState {
  return {
    messages: [],
    streamingText: "",
    activeTools: [],
    connectionState: "connecting",
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
