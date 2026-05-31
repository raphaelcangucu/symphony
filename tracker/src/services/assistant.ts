import type { Comment } from "@/types/comment";
import type { Issue } from "@/types/issue";

import { http, trackerPath, unwrapData } from "./http";
import {
  type BackendCommentDto,
  type BackendIssueDto,
  normalizeComment,
  normalizeIssue,
} from "./mappers";

export interface AssistantMessageContext {
  view?: "board" | "list";
  selectedIssueIdentifier?: string | null;
}

export interface SendAssistantMessageInput {
  message: string;
  context?: AssistantMessageContext;
}

export type AssistantToolStatus = "running" | "complete" | "error";

export interface AssistantToolCall {
  name: string;
  status: AssistantToolStatus;
  result: {
    issue?: Issue;
    issues?: Issue[];
    comment?: Comment;
    agentExecutions?: unknown[];
    [key: string]: unknown;
  };
}

export interface AssistantMessageResponse {
  assistantMessage: string;
  toolCalls: AssistantToolCall[];
}

export type AssistantChatRole = "user" | "assistant" | "tool" | "system";

export interface AssistantChatMessage {
  id: string;
  role: AssistantChatRole;
  content: string;
  toolCalls: AssistantToolCall[];
  turnId?: string | null;
  sequence?: number | null;
  insertedAt?: string | null;
  metadata: Record<string, unknown>;
}

interface BackendAssistantToolCallDto {
  name?: string | null;
  status?: string | null;
  result?: {
    issue?: BackendIssueDto | null;
    issues?: BackendIssueDto[] | null;
    comment?: BackendCommentDto | null;
    agent_executions?: unknown[] | null;
    agentExecutions?: unknown[] | null;
    [key: string]: unknown;
  } | null;
}

interface BackendAssistantMessageDto {
  assistant_message?: string | null;
  assistantMessage?: string | null;
  tool_calls?: BackendAssistantToolCallDto[] | null;
  toolCalls?: BackendAssistantToolCallDto[] | null;
}

export interface BackendAssistantChatMessageDto {
  id?: string | number | null;
  role?: string | null;
  content?: string | null;
  tool_calls?: BackendAssistantToolCallDto[] | null;
  toolCalls?: BackendAssistantToolCallDto[] | null;
  turn_id?: string | null;
  turnId?: string | null;
  sequence?: number | null;
  inserted_at?: string | null;
  insertedAt?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function sendAssistantMessage(
  projectSlug: string,
  input: SendAssistantMessageInput,
): Promise<AssistantMessageResponse> {
  const slug = projectSlug.trim();
  const message = input.message.trim();
  if (!slug) throw new Error("projectSlug is required");
  if (!message) throw new Error("message is required");

  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(slug)}/assistant/messages`), {
    message,
    context: input.context ?? {},
  });

  return normalizeAssistantMessage(unwrapData<BackendAssistantMessageDto>(response));
}

export function normalizeAssistantMessage(dto: BackendAssistantMessageDto): AssistantMessageResponse {
  return {
    assistantMessage: dto.assistantMessage ?? dto.assistant_message ?? "",
    toolCalls: (dto.toolCalls ?? dto.tool_calls ?? []).map(normalizeToolCall),
  };
}

export function normalizeAssistantChatMessage(dto: BackendAssistantChatMessageDto): AssistantChatMessage {
  return {
    id: String(dto.id ?? `assistant-message-${dto.sequence ?? cryptoRandomId()}`),
    role: normalizeRole(dto.role),
    content: dto.content ?? "",
    toolCalls: (dto.toolCalls ?? dto.tool_calls ?? []).map(normalizeToolCall),
    turnId: dto.turnId ?? dto.turn_id ?? null,
    sequence: dto.sequence ?? null,
    insertedAt: dto.insertedAt ?? dto.inserted_at ?? null,
    metadata: dto.metadata ?? {},
  };
}

export function normalizeToolCall(dto: BackendAssistantToolCallDto): AssistantToolCall {
  const result = dto.result ?? {};

  return {
    name: dto.name ?? "unknown",
    status: normalizeToolStatus(dto.status),
    result: {
      ...result,
      issue: result.issue ? normalizeIssue(result.issue) : undefined,
      issues: Array.isArray(result.issues) ? result.issues.map(normalizeIssue) : undefined,
      comment: result.comment ? normalizeComment(result.comment) : undefined,
      agentExecutions: result.agentExecutions ?? result.agent_executions ?? undefined,
    },
  };
}

function normalizeToolStatus(status: string | null | undefined): AssistantToolStatus {
  if (status === "running" || status === "complete" || status === "error") return status;
  return "complete";
}

function normalizeRole(role: string | null | undefined): AssistantChatRole {
  if (role === "user" || role === "assistant" || role === "tool" || role === "system") return role;
  return "assistant";
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}
