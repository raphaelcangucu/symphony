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
  onHistoryLoaded: (messages: AssistantChatMessage[], meta?: AssistantHistoryMeta) => void;
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
  onTurnStatus?: (status: AssistantTurnStatus) => void;
  onHistorySynced?: (messages: AssistantChatMessage[]) => void;
  onApprovalRequired?: (request: AssistantApprovalRequest) => void;
}

export interface AssistantHistoryMeta {
  executionMode?: string | null;
  skillProfile?: string | null;
  scope?: string | null;
  threadId?: number | null;
}

/** Complete thread-scoped Goal snapshot from durable state plus live process presence. */
export interface AuthoringGoalStatus {
  threadId: number | null;
  enabled: boolean;
  objective: string | null;
  native: boolean;
  status: string | null;
  provider: string | null;
  source: string | null;
  capabilities: string[];
  goal: AgentExecutionGoal | null;
  tokenBudget: number | null;
  tokensUsed: number | null;
  timeUsedSeconds: number | null;
  processRunning: boolean;
  processStartedAt: string | null;
  processElapsedSeconds: number | null;
  resumable: boolean;
  interrupted: boolean;
  revision: string | null;
  updatedAt: string | null;
  requestOrder: number | null;
  eventOrder: number | null;
  error: string | null;
  running: boolean;
}

interface BackendGoalStatusPayload {
  thread_id?: number | string | null;
  threadId?: number | string | null;
  enabled?: boolean | null;
  objective?: string | null;
  native?: boolean | null;
  status?: string | null;
  provider?: string | null;
  source?: string | null;
  capabilities?: unknown;
  goal?: Record<string, unknown> | null;
  token_budget?: number | null;
  tokenBudget?: number | null;
  tokens_used?: number | null;
  tokensUsed?: number | null;
  time_used_seconds?: number | null;
  timeUsedSeconds?: number | null;
  process_running?: boolean | null;
  processRunning?: boolean | null;
  process_started_at?: string | null;
  processStartedAt?: string | null;
  process_elapsed_seconds?: number | null;
  processElapsedSeconds?: number | null;
  resumable?: boolean | null;
  interrupted?: boolean | null;
  revision?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
  request_order?: number | null;
  requestOrder?: number | null;
  event_order?: number | null;
  eventOrder?: number | null;
  error?: string | null;
  running?: boolean | null;
}

export function normalizeGoalStatus(payload: unknown): AuthoringGoalStatus {
  const data = (payload ?? {}) as BackendGoalStatusPayload;
  const processRunning = data.processRunning ?? data.process_running ?? data.running;
  return {
    threadId: normalizeThreadId(data.threadId ?? data.thread_id),
    enabled: data.enabled === true,
    objective: typeof data.objective === "string" && data.objective.trim() !== "" ? data.objective : null,
    native: data.native === true,
    status: nonEmptyString(data.status),
    provider: nonEmptyString(data.provider),
    source: nonEmptyString(data.source),
    capabilities: normalizeGoalCapabilities(data.capabilities),
    goal: normalizeGoal(data.goal ?? null),
    tokenBudget: finiteNumber(data.tokenBudget ?? data.token_budget),
    tokensUsed: finiteNumber(data.tokensUsed ?? data.tokens_used),
    timeUsedSeconds: finiteNumber(data.timeUsedSeconds ?? data.time_used_seconds),
    processRunning: processRunning === true,
    processStartedAt: nonEmptyString(data.processStartedAt ?? data.process_started_at),
    processElapsedSeconds: finiteNumber(data.processElapsedSeconds ?? data.process_elapsed_seconds),
    resumable: data.resumable === true,
    interrupted: data.interrupted === true,
    revision: nonEmptyString(data.revision),
    updatedAt: nonEmptyString(data.updatedAt ?? data.updated_at),
    requestOrder: finiteNumber(data.requestOrder ?? data.request_order),
    eventOrder: finiteNumber(data.eventOrder ?? data.event_order),
    error: nonEmptyString(data.error),
    running: processRunning === true,
  };
}

export function readGoalStatus(joinPayload: unknown): AuthoringGoalStatus | null {
  const data = (joinPayload ?? {}) as { goal_status?: unknown };
  return data.goal_status ? normalizeGoalStatus(data.goal_status) : null;
}

export function shouldAcceptGoalStatus(
  incoming: AuthoringGoalStatus,
  current: AuthoringGoalStatus | null,
): boolean {
  if (!current) return true;
  if (current.threadId != null && incoming.threadId !== current.threadId) return false;

  const durableComparison = compareGoalDurableRevision(incoming, current);
  if (durableComparison === null) return false;
  if (durableComparison > 0) return true;
  if (durableComparison < 0) return false;
  return goalRequestOrder(incoming) > goalRequestOrder(current);
}

/**
 * Normalized lifecycle status for the thread's current/last turn. `canResume` is
 * only ever true when the backend reports an interrupted turn that can be
 * re-dispatched via `resumeTurn`.
 */
export interface AssistantActiveTool {
  id: string;
  name: string;
  argumentsSummary: string | null;
  startedAt: string | null;
}

export interface AssistantTurnStatus {
  status: string;
  generation: string | null;
  sessionId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  canResume: boolean;
  activeTools: AssistantActiveTool[];
  lastActivityAt: string | null;
}

export interface AssistantApprovalRequest {
  requestId: string | number;
  command: string | null;
  cwd: string | null;
  reason: string | null;
  toolName: string | null;
  agent: AgentKind | null;
}

interface BackendActiveToolPayload {
  id?: string | null;
  name?: string | null;
  arguments_summary?: string | null;
  argumentsSummary?: string | null;
  started_at?: string | null;
  startedAt?: string | null;
}

interface BackendTurnStatusPayload {
  status?: string | null;
  generation?: string | null;
  session_id?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  can_resume?: boolean | null;
  active_tools?: BackendActiveToolPayload[] | null;
  last_activity_at?: string | null;
}

export function normalizeTurnStatus(payload: unknown): AssistantTurnStatus {
  const data = (payload ?? {}) as BackendTurnStatusPayload;
  return {
    status: typeof data.status === "string" ? data.status : "unknown",
    generation: typeof data.generation === "string" ? data.generation : null,
    sessionId: typeof data.session_id === "string" ? data.session_id : null,
    startedAt: typeof data.started_at === "string" ? data.started_at : null,
    finishedAt: typeof data.finished_at === "string" ? data.finished_at : null,
    canResume: data.can_resume === true,
    activeTools: normalizeActiveTools(data.active_tools),
    lastActivityAt: typeof data.last_activity_at === "string" ? data.last_activity_at : null,
  };
}

function normalizeActiveTools(tools: BackendActiveToolPayload[] | null | undefined): AssistantActiveTool[] {
  if (!Array.isArray(tools)) return [];

  return tools.flatMap((tool) => {
    const id = typeof tool?.id === "string" ? tool.id.trim() : "";
    const name = typeof tool?.name === "string" ? tool.name.trim() : "";
    if (!id || !name) return [];

    const summary = tool.arguments_summary ?? tool.argumentsSummary;
    const started = tool.started_at ?? tool.startedAt;

    return [
      {
        id,
        name,
        argumentsSummary: typeof summary === "string" && summary.trim().length > 0 ? summary : null,
        startedAt: typeof started === "string" && started.trim().length > 0 ? started : null,
      },
    ];
  });
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
  execution_mode?: string | null;
  skill_profile?: string | null;
  scope?: string | null;
  thread_id?: number | string | null;
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

export type GoalStatusAcceptor = (payload: unknown) => boolean;

export function bindAssistantEvents(channel: Channel, handlers: AssistantChannelHandlers): GoalStatusAcceptor {
  let latestGoalStatus: AuthoringGoalStatus | null = null;

  const acceptGoalStatus = (payload: unknown) => {
    const status = normalizeGoalStatus(payload as BackendGoalStatusPayload);
    if (!shouldAcceptGoalStatus(status, latestGoalStatus)) return false;
    latestGoalStatus = status;
    handlers.onGoalStatus?.(status);
    return true;
  };

  channel.on("history_loaded", (payload) => {
    const data = payload as HistoryLoadedPayload & { last_turn?: unknown };
    const messages = (data.messages ?? []).map(normalizeAssistantChatMessage);
    handlers.onHistoryLoaded(messages, {
      executionMode: typeof data.execution_mode === "string" ? data.execution_mode : null,
      skillProfile: typeof data.skill_profile === "string" ? data.skill_profile : null,
      scope: typeof data.scope === "string" ? data.scope : null,
      threadId: normalizeThreadId(data.thread_id),
    });

    const joinedLastTurn = readLastTurn(data);
    if (joinedLastTurn) handlers.onTurnStatus?.(joinedLastTurn);

    const joinedGoalStatus = readGoalStatus(data);
    if (joinedGoalStatus && shouldAcceptGoalStatus(joinedGoalStatus, latestGoalStatus)) {
      latestGoalStatus = joinedGoalStatus;
      handlers.onGoalStatus?.(joinedGoalStatus);
    }
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
    acceptGoalStatus(payload);
  });

  channel.on("authoring_goal_changed", (payload) => {
    acceptGoalStatus(payload);
  });

  channel.on("turn_status", (payload) => {
    handlers.onTurnStatus?.(normalizeTurnStatus(payload));
  });

  return acceptGoalStatus;
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

export function stopTurn(channel: Channel): ReturnType<Channel["push"]> {
  return channel.push("stop_turn", {});
}

export function killTool(channel: Channel, toolCallId: string): ReturnType<Channel["push"]> {
  if (typeof toolCallId !== "string" || toolCallId.trim().length === 0) {
    throw new Error("toolCallId is required");
  }

  return channel.push("kill_tool", { tool_call_id: toolCallId.trim() });
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

export function setTurnPreferences(
  channel: Channel,
  preferences: { executionMode?: ExecutionMode | null; skillProfile?: string | null },
): ReturnType<Channel["push"]> {
  const payload: Record<string, unknown> = {};
  if (preferences.executionMode != null) {
    payload.execution_mode = preferences.executionMode;
  }
  if (preferences.skillProfile != null) {
    payload.skill_profile = preferences.skillProfile;
  }
  return channel.push("set_turn_preferences", payload);
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

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeGoalCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value.flatMap((capability) => {
        if (typeof capability !== "string") return [];
        const normalized = capability.trim();
        return normalized ? [normalized] : [];
      }),
    ),
  ];
}

function compareGoalDurableRevision(
  incoming: AuthoringGoalStatus,
  current: AuthoringGoalStatus,
): -1 | 0 | 1 | null {
  if (incoming.revision && incoming.revision === current.revision) return 0;

  const incomingNumericRevision = numericRevision(incoming.revision);
  const currentNumericRevision = numericRevision(current.revision);
  if (incomingNumericRevision != null && currentNumericRevision != null) {
    if (incomingNumericRevision > currentNumericRevision) return 1;
    if (incomingNumericRevision < currentNumericRevision) return -1;
    return 0;
  }

  const incomingUpdatedAt = timestampRevision(incoming.updatedAt);
  const currentUpdatedAt = timestampRevision(current.updatedAt);
  if (incomingUpdatedAt != null && currentUpdatedAt != null) {
    if (incomingUpdatedAt > currentUpdatedAt) return 1;
    if (incomingUpdatedAt < currentUpdatedAt) return -1;
    return incoming.revision === current.revision ? 0 : null;
  }

  if (!current.revision && !current.updatedAt) return 1;
  if (!incoming.revision && !incoming.updatedAt) return -1;
  return null;
}

function numericRevision(value: string | null): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function timestampRevision(value: string | null): bigint | null {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;

  const fractionalDigits = value.match(/\.(\d+)/)?.[1] ?? "";
  const subMillisecondMicros = fractionalDigits.padEnd(6, "0").slice(3, 6);
  return BigInt(milliseconds) * 1_000n + BigInt(subMillisecondMicros || "0");
}

function goalRequestOrder(status: AuthoringGoalStatus): number {
  return status.requestOrder ?? status.eventOrder ?? -1;
}

function normalizeApprovalAgent(value: unknown): AgentKind | null {
  if (value === "claude" || value === "codex" || value === "cursor") return value;
  return null;
}
