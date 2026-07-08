import type { Channel } from "phoenix";

import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";

import {
  normalizeAssistantChatMessage,
  normalizeToolCall,
  normalizeUserQuestionsRequest,
  type AssistantChatMessage,
  type AssistantToolCall,
  type BackendAssistantChatMessageDto,
  type UserQuestionsRequest,
} from "@/services/assistant";
import { normalizeGoal } from "@/services/agentExecutions";
import type { AgentExecutionGoal } from "@/types/agent-execution";
import type { AgentKind, ExecutionMode } from "@/types/issue";

export interface AssistantChannelHandlers {
  onHistoryLoaded: (messages: AssistantChatMessage[]) => void;
  onMessageCreated: (message: AssistantChatMessage) => void;
  onAssistantDelta: (delta: string) => void;
  onToolCallStarted: (toolCall: AssistantToolCall) => void;
  onToolCallCompleted: (toolCall: AssistantToolCall) => void;
  onAssistantCompleted: (message: AssistantChatMessage) => void;
  onAssistantError: (message: string) => void;
  onAssistantDocumentChanged?: (payload: AssistantDocumentChangedPayload) => void;
  onAssistantIssueCreated?: (payload: AssistantIssueCreatedPayload) => void;
  onSteerFailed?: (payload: { reason: string; message: string }) => void;
  onUserInputRequired?: (request: UserQuestionsRequest) => void;
  onBtwDelta?: (payload: { btwId: string; delta: string }) => void;
  onBtwCompleted?: (payload: { btwId: string; message: string }) => void;
  onBtwError?: (payload: { btwId: string; message: string }) => void;
  onGoalStatus?: (status: AuthoringGoalStatus) => void;
  onGoalRunning?: (running: boolean) => void;
  onTurnStatus?: (status: AssistantTurnStatus) => void;
  onHistorySynced?: (messages: AssistantChatMessage[]) => void;
  onApprovalRequired?: (request: AssistantApprovalRequest) => void;
}

/**
 * Normalized authoring-goal status pushed by the channel. `goal` carries the
 * native Codex goal (status + timer) when one exists; `enabled`/`objective`
 * mirror the thread metadata so the pill can render before a turn establishes
 * the native goal.
 */
export interface AuthoringGoalStatus {
  enabled: boolean;
  objective: string | null;
  native: boolean;
  goal: AgentExecutionGoal | null;
  running: boolean;
}

interface BackendGoalStatusPayload {
  enabled?: boolean | null;
  objective?: string | null;
  native?: boolean | null;
  goal?: Record<string, unknown> | null;
  running?: boolean | null;
}

export function normalizeGoalStatus(payload: unknown): AuthoringGoalStatus {
  const data = (payload ?? {}) as BackendGoalStatusPayload;
  return {
    enabled: data.enabled === true,
    objective: typeof data.objective === "string" && data.objective.trim() !== "" ? data.objective : null,
    native: data.native === true,
    goal: normalizeGoal(data.goal ?? null),
    running: data.running === true,
  };
}

/**
 * Normalized lifecycle status for the thread's current/last turn. `canResume` is
 * only ever true when the backend reports an interrupted turn that can be
 * re-dispatched via `resumeTurn`.
 */
export interface AssistantTurnStatus {
  status: string;
  sessionId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  canResume: boolean;
}

export interface AssistantApprovalRequest {
  requestId: string | number;
  command: string | null;
  cwd: string | null;
  reason: string | null;
  toolName: string | null;
  agent: AgentKind | null;
}

interface BackendTurnStatusPayload {
  status?: string | null;
  session_id?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  can_resume?: boolean | null;
}

export function normalizeTurnStatus(payload: unknown): AssistantTurnStatus {
  const data = (payload ?? {}) as BackendTurnStatusPayload;
  return {
    status: typeof data.status === "string" ? data.status : "unknown",
    sessionId: typeof data.session_id === "string" ? data.session_id : null,
    startedAt: typeof data.started_at === "string" ? data.started_at : null,
    finishedAt: typeof data.finished_at === "string" ? data.finished_at : null,
    canResume: data.can_resume === true,
  };
}

export function readLastTurn(joinPayload: unknown): AssistantTurnStatus | null {
  const data = (joinPayload ?? {}) as { last_turn?: unknown };
  return data.last_turn ? normalizeTurnStatus(data.last_turn) : null;
}

export interface AssistantDocumentChangedPayload {
  identifier?: string;
  threadId?: number;
}

export interface AssistantIssueCreatedPayload {
  identifier: string;
  threadId: number | null;
}

interface HistoryLoadedPayload {
  messages?: BackendAssistantChatMessageDto[] | null;
}

interface MessagePayload {
  message?: BackendAssistantChatMessageDto | null;
}

interface DeltaPayload {
  delta?: string | null;
}

interface ToolCallPayload {
  tool_call?: Parameters<typeof normalizeToolCall>[0] | null;
  toolCall?: Parameters<typeof normalizeToolCall>[0] | null;
}

interface ErrorPayload {
  message?: string | null;
}

interface ApprovalRequiredPayload {
  request_id?: string | number | null;
  requestId?: string | number | null;
  command?: string | null;
  cwd?: string | null;
  reason?: string | null;
  tool_name?: string | null;
  toolName?: string | null;
  agent?: string | null;
}

interface DocumentChangedPayload {
  identifier?: string | null;
  thread_id?: number | string | null;
  threadId?: number | string | null;
}

interface IssueCreatedPayload {
  identifier?: string | null;
  thread_id?: number | string | null;
  threadId?: number | string | null;
}

export function assistantTopic(projectSlug: string): string {
  const slug = requireProjectSlug(projectSlug);
  return `assistant:${slug}`;
}

export function assistantExploreTopic(projectSlug: string): string {
  const slug = requireProjectSlug(projectSlug);
  return `assistant:explore:${encodeURIComponent(slug)}`;
}

export function assistantKbTopic(projectSlug: string, repoSlug: string, pagePath: string): string {
  const slug = requireProjectSlug(projectSlug);
  const repo = requireNonBlank(repoSlug, "repoSlug");
  const path = requireNonBlank(pagePath, "pagePath");

  return `assistant:kb:${encodeURIComponent(slug)}:${encodeURIComponent(repo)}:${encodeURIComponent(path)}`;
}

export function assistantThreadTopic(threadId: number | string): string {
  const id = requireNonBlank(String(threadId), "threadId");
  return `assistant:thread:${id}`;
}

export function assistantIssueTopic(projectSlug: string, identifier: string): string {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(identifier, "identifier");

  return `assistant:issue:${encodeURIComponent(slug)}:${encodeURIComponent(issueIdentifier)}`;
}

export function bindAssistantEvents(channel: Channel, handlers: AssistantChannelHandlers): void {
  channel.on("history_loaded", (payload) => {
    const data = payload as HistoryLoadedPayload & { last_turn?: unknown };
    const messages = (data.messages ?? []).map(normalizeAssistantChatMessage);
    handlers.onHistoryLoaded(messages);

    const joinedLastTurn = readLastTurn(data);
    if (joinedLastTurn) handlers.onTurnStatus?.(joinedLastTurn);
  });

  channel.on("history_synced", (payload) => {
    const data = payload as HistoryLoadedPayload;
    const messages = (data.messages ?? []).map(normalizeAssistantChatMessage);
    handlers.onHistorySynced?.(messages);
  });

  channel.on("message_created", (payload) => {
    const message = (payload as MessagePayload).message;
    if (message) handlers.onMessageCreated(normalizeAssistantChatMessage(message));
  });

  channel.on("assistant_delta", (payload) => {
    const delta = (payload as DeltaPayload).delta;
    if (typeof delta === "string" && delta.length > 0) handlers.onAssistantDelta(delta);
  });

  channel.on("tool_call_started", (payload) => {
    const toolCall = (payload as ToolCallPayload).toolCall ?? (payload as ToolCallPayload).tool_call;
    if (toolCall) handlers.onToolCallStarted(normalizeToolCall(toolCall));
  });

  channel.on("tool_call_completed", (payload) => {
    const toolCall = (payload as ToolCallPayload).toolCall ?? (payload as ToolCallPayload).tool_call;
    if (toolCall) handlers.onToolCallCompleted(normalizeToolCall(toolCall));
  });

  channel.on("assistant_completed", (payload) => {
    const message = (payload as MessagePayload).message;
    if (message) handlers.onAssistantCompleted(normalizeAssistantChatMessage(message));
  });

  channel.on("assistant_error", (payload) => {
    handlers.onAssistantError((payload as ErrorPayload).message ?? "Assistant request failed");
  });

  channel.on("assistant_document_changed", (payload) => {
    const data = payload as DocumentChangedPayload;
    const identifier = data.identifier?.trim();
    const threadId = normalizeThreadId(data.threadId ?? data.thread_id);

    if (!identifier && threadId == null) return;

    handlers.onAssistantDocumentChanged?.({ identifier: identifier || undefined, threadId: threadId ?? undefined });
  });

  channel.on("assistant_issue_created", (payload) => {
    const created = payload as IssueCreatedPayload;
    const identifier = created.identifier?.trim();
    if (!identifier) return;

    handlers.onAssistantIssueCreated?.({ identifier, threadId: normalizeThreadId(created.threadId ?? created.thread_id) });
  });

  channel.on("user_input_required", (payload) => {
    const request = normalizeUserQuestionsRequest(payload as Parameters<typeof normalizeUserQuestionsRequest>[0]);
    if (request) handlers.onUserInputRequired?.(request);
  });

  channel.on("approval_required", (payload) => {
    const request = normalizeApprovalRequest(payload);
    if (request) handlers.onApprovalRequired?.(request);
  });

  channel.on("steer_failed", (payload) => {
    const data = payload as { reason?: string | null; message?: string | null };
    handlers.onSteerFailed?.({
      reason: data.reason ?? "steer_failed",
      message: data.message ?? "",
    });
  });

  channel.on("btw_delta", (payload) => {
    const data = payload as { btw_id?: string | null; delta?: string | null };
    if (data.btw_id && typeof data.delta === "string") handlers.onBtwDelta?.({ btwId: data.btw_id, delta: data.delta });
  });

  channel.on("btw_completed", (payload) => {
    const data = payload as { btw_id?: string | null; message?: string | null };
    if (data.btw_id) handlers.onBtwCompleted?.({ btwId: data.btw_id, message: data.message ?? "" });
  });

  channel.on("btw_error", (payload) => {
    const data = payload as { btw_id?: string | null; message?: string | null };
    if (data.btw_id) handlers.onBtwError?.({ btwId: data.btw_id, message: data.message ?? "Side question failed" });
  });

  channel.on("goal_status", (payload) => {
    handlers.onGoalStatus?.(normalizeGoalStatus(payload as BackendGoalStatusPayload));
  });

  channel.on("goal_running", (payload) => {
    handlers.onGoalRunning?.((payload as { running?: boolean | null }).running === true);
  });

  channel.on("turn_status", (payload) => {
    handlers.onTurnStatus?.(normalizeTurnStatus(payload));
  });
}

export function requestGoalStatus(channel: Channel): ReturnType<Channel["push"]> {
  return channel.push("goal_status", {});
}

export function pauseAuthoringGoal(channel: Channel): ReturnType<Channel["push"]> {
  return channel.push("goal_pause", {});
}

export function resumeAuthoringGoal(channel: Channel): ReturnType<Channel["push"]> {
  return channel.push("goal_resume", {});
}

export function clearAuthoringGoal(channel: Channel): ReturnType<Channel["push"]> {
  return channel.push("goal_clear", {});
}

export function resumeTurn(channel: Channel): ReturnType<Channel["push"]> {
  return channel.push("resume_turn", {});
}

export function requestHistorySync(channel: Channel): ReturnType<Channel["push"]> {
  return channel.push("sync_history", {});
}

export function isTerminalTurnStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "interrupted";
}

export function setAuthoringGoalObjective(channel: Channel, objective: string): ReturnType<Channel["push"]> {
  return channel.push("goal_set_objective", { objective });
}

export function submitUserInput(
  channel: Channel,
  requestId: string | number,
  answers: Record<string, string>,
): void {
  channel.push("submit_user_input", { request_id: requestId, answers });
}

export function submitApproval(
  channel: Channel,
  requestId: string | number,
  action: "approve" | "cancel",
): ReturnType<Channel["push"]> {
  return channel.push("submit_approval", { request_id: requestId, action });
}

export function dispatchCodingAgent(
  channel: Channel,
  options: { goalMode: boolean; agent?: AgentKind | null; mode?: ExecutionMode | null },
): ReturnType<Channel["push"]> {
  const payload: Record<string, unknown> = { goal_mode: options.goalMode };
  if (options.agent != null) {
    payload.agent = options.agent;
  }
  if (options.mode != null) {
    payload.mode = options.mode;
  }
  return channel.push("dispatch_coding_agent", payload);
}

function normalizeThreadId(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value !== "string") return null;

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && String(parsed) === value.trim() && parsed > 0 ? parsed : null;
}

function normalizeApprovalRequest(payload: unknown): AssistantApprovalRequest | null {
  const data = (payload ?? {}) as ApprovalRequiredPayload;
  const requestId = data.requestId ?? data.request_id;
  if (typeof requestId !== "string" && typeof requestId !== "number") return null;

  return {
    requestId,
    command: nonEmptyString(data.command),
    cwd: nonEmptyString(data.cwd),
    reason: nonEmptyString(data.reason),
    toolName: nonEmptyString(data.tool_name ?? data.toolName),
    agent: normalizeApprovalAgent(data.agent),
  };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeApprovalAgent(value: unknown): AgentKind | null {
  if (value === "claude" || value === "codex" || value === "cursor") return value;
  return null;
}
