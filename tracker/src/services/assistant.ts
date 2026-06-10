import axios from "axios";

import {
  fallbackCatalogBundle,
  fallbackClaudeCatalog,
  fallbackCodexCatalog,
  loadCachedCatalogBundle,
  saveCachedCatalogBundle,
  type AssistantAgentCatalog,
  type AssistantCatalogBundle,
  type AssistantCodexCatalog,
  type AssistantEffortOption,
  type AssistantModelOption,
} from "@/lib/assistantSettings";
import type { AgentKind } from "@/types/issue";
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
  arguments?: Record<string, unknown> | null;
  output?: string | null;
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

export interface UserQuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: UserQuestionOption[] | null;
}

export interface UserQuestionsRequest {
  requestId: string | number;
  questions: UserQuestion[];
}

export function normalizeUserQuestionsRequest(payload: {
  request_id?: string | number | null;
  requestId?: string | number | null;
  questions?: unknown;
}): UserQuestionsRequest | null {
  const requestId = payload.requestId ?? payload.request_id;
  if (requestId == null) return null;

  const rawQuestions = Array.isArray(payload.questions) ? payload.questions : [];
  const questions = rawQuestions
    .map((raw): UserQuestion | null => {
      const q = raw as Record<string, unknown>;
      const id = typeof q.id === "string" ? q.id : null;
      if (!id) return null;

      const options = Array.isArray(q.options)
        ? q.options
            .map((opt): UserQuestionOption | null => {
              const o = opt as Record<string, unknown>;
              if (typeof o.label !== "string") return null;
              const option: UserQuestionOption = { label: o.label };
              if (typeof o.description === "string") option.description = o.description;
              return option;
            })
            .filter((opt): opt is UserQuestionOption => opt !== null)
        : null;

      return {
        id,
        header: typeof q.header === "string" ? q.header : "",
        question: typeof q.question === "string" ? q.question : "",
        isOther: q.isOther === true,
        isSecret: q.isSecret === true,
        options,
      };
    })
    .filter((q): q is UserQuestion => q !== null);

  return { requestId, questions };
}

interface BackendAssistantToolCallDto {
  name?: string | null;
  status?: string | null;
  arguments?: Record<string, unknown> | null;
  output?: string | null;
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

interface BackendAssistantEffortDto {
  id?: string | null;
  label?: string | null;
  description?: string | null;
}

interface BackendAssistantModelDto {
  id?: string | null;
  model?: string | null;
  label?: string | null;
  description?: string | null;
  is_default?: boolean | null;
  isDefault?: boolean | null;
  default_effort?: string | null;
  defaultEffort?: string | null;
  efforts?: BackendAssistantEffortDto[] | null;
  input_modalities?: string[] | null;
  inputModalities?: string[] | null;
}

interface BackendAssistantCodexCatalogDto {
  agent?: string | null;
  agent_label?: string | null;
  agentLabel?: string | null;
  command?: string | null;
  default_model?: string | null;
  defaultModel?: string | null;
  models?: BackendAssistantModelDto[] | null;
}

interface BackendAssistantCatalogBundleDto {
  agents?: BackendAssistantCodexCatalogDto[] | null;
  default_agent?: string | null;
  defaultAgent?: string | null;
}

interface BackendUploadedAttachmentDto {
  id?: string | null;
  type?: string | null;
  name?: string | null;
  media_type?: string | null;
  mediaType?: string | null;
  path?: string | null;
  size_bytes?: number | null;
  sizeBytes?: number | null;
}

export interface UploadedAssistantAttachment {
  id: string;
  type: "image" | "file";
  name: string;
  mediaType: string;
  path: string;
  sizeBytes?: number;
}

export async function uploadAssistantAttachment(
  projectSlug: string,
  file: File,
): Promise<UploadedAssistantAttachment> {
  const slug = projectSlug.trim();
  if (!slug) throw new Error("projectSlug is required");

  const form = new FormData();
  form.append("file", file);

  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(slug)}/assistant/attachments`), form, {
    headers: { "Content-Type": "multipart/form-data" },
  });

  const dto = unwrapData<BackendUploadedAttachmentDto>(response);
  const path = dto.path?.trim();
  if (!path) throw new Error("Upload response did not include a file path.");

  return {
    id: dto.id ?? path,
    type: dto.type === "file" ? "file" : "image",
    name: dto.name ?? file.name,
    mediaType: dto.mediaType ?? dto.media_type ?? file.type,
    path,
    sizeBytes: dto.sizeBytes ?? dto.size_bytes ?? undefined,
  };
}

export async function fetchAssistantCatalogBundle(projectSlug: string): Promise<AssistantCatalogBundle> {
  const slug = projectSlug.trim();
  if (!slug) throw new Error("projectSlug is required");

  try {
    const response = await http.get(trackerPath(`/projects/${encodeURIComponent(slug)}/assistant/config`));
    const raw = unwrapData<BackendAssistantCatalogBundleDto>(response);
    const bundle = normalizeAssistantCatalogBundle(raw);
    saveCachedCatalogBundle(bundle);
    return bundle;
  } catch (cause) {
    if (axios.isAxiosError(cause) && cause.response?.status === 404) {
      throw new Error(
        "Assistant API is missing on the server. Restart Symphony so it loads the latest tracker routes.",
      );
    }

    if (axios.isAxiosError(cause) && cause.response?.status === 503) {
      const cached = loadCachedCatalogBundle();
      if (cached) return cached;

      const bundle = fallbackCatalogBundle();
      // Propagate error command hint from the 503 body when available
      const errorMsg =
        axios.isAxiosError(cause) &&
        typeof cause.response?.data === "object" &&
        cause.response?.data !== null &&
        "error" in cause.response.data &&
        typeof (cause.response.data as { error?: { message?: string } }).error?.message === "string"
          ? (cause.response.data as { error?: { message?: string } }).error?.message
          : null;
      if (errorMsg) {
        const codex = bundle.agents.find((a) => a.agent === "codex");
        if (codex) codex.command = errorMsg;
      }
      return bundle;
    }

    const cached = loadCachedCatalogBundle();
    if (cached) return cached;

    throw new Error(extractApiErrorMessage(cause, "Failed to load assistant models."));
  }
}

/**
 * @deprecated Use fetchAssistantCatalogBundle. Returns only the codex catalog
 * for callers that haven't been updated yet.
 */
export async function fetchAssistantCodexCatalog(projectSlug: string): Promise<AssistantCodexCatalog> {
  const bundle = await fetchAssistantCatalogBundle(projectSlug);
  return bundle.agents.find((c) => c.agent === "codex") ?? bundle.agents[0];
}

export function normalizeAssistantCodexCatalog(dto: BackendAssistantCodexCatalogDto): AssistantCodexCatalog {
  const models = (dto.models ?? []).map(normalizeAssistantModel).filter((model) => model.model.length > 0);

  if (models.length === 0) {
    throw new Error("Codex CLI returned no models");
  }

  return {
    agent: "codex",
    agentLabel: dto.agentLabel ?? dto.agent_label ?? "Codex CLI",
    command: dto.command ?? "codex app-server",
    defaultModel: dto.defaultModel ?? dto.default_model ?? null,
    models,
  };
}

export function normalizeAssistantCatalogBundle(dto: BackendAssistantCatalogBundleDto): AssistantCatalogBundle {
  const rawAgents = Array.isArray(dto.agents) ? dto.agents : [];

  const agents: AssistantAgentCatalog[] = rawAgents
    .map((agentDto): AssistantAgentCatalog | null => {
      const agentKind = agentDto.agent;
      if (agentKind !== "codex" && agentKind !== "claude") return null;

      const models = (agentDto.models ?? []).map(normalizeAssistantModel).filter((m) => m.model.length > 0);
      if (models.length === 0) {
        return agentKind === "claude" ? fallbackClaudeCatalog() : fallbackCodexCatalog();
      }

      return {
        agent: agentKind as AgentKind,
        agentLabel: agentDto.agentLabel ?? agentDto.agent_label ?? (agentKind === "claude" ? "Claude Code" : "Codex CLI"),
        command: agentDto.command ?? (agentKind === "claude" ? "claude" : "codex app-server"),
        defaultModel: agentDto.defaultModel ?? agentDto.default_model ?? null,
        models,
      };
    })
    .filter((a): a is AssistantAgentCatalog => a !== null);

  if (agents.length === 0) {
    return fallbackCatalogBundle();
  }

  const rawDefault = dto.defaultAgent ?? dto.default_agent;
  const defaultAgent: AgentKind =
    rawDefault === "codex" || rawDefault === "claude"
      ? rawDefault
      : (agents[0].agent as AgentKind);

  return { agents, defaultAgent };
}

function normalizeAssistantModel(dto: BackendAssistantModelDto): AssistantModelOption {
  const model = dto.model ?? dto.id ?? "";
  const efforts = (dto.efforts ?? []).map(normalizeAssistantEffort).filter((effort) => effort.id.length > 0);
  const defaultEffort = dto.defaultEffort ?? dto.default_effort ?? efforts[0]?.id ?? "medium";

  return {
    id: dto.id ?? model,
    model,
    label: dto.label ?? model,
    description: dto.description ?? undefined,
    isDefault: dto.isDefault ?? dto.is_default ?? false,
    defaultEffort,
    efforts: efforts.length > 0 ? efforts : defaultEffort ? [{ id: defaultEffort, label: defaultEffort }] : [],
    inputModalities: dto.inputModalities ?? dto.input_modalities ?? undefined,
  };
}

function extractApiErrorMessage(cause: unknown, fallback: string): string {
  if (axios.isAxiosError(cause)) {
    const body = cause.response?.data;
    if (body && typeof body === "object" && "error" in body) {
      const error = (body as { error?: { message?: string } }).error;
      if (error?.message) return error.message;
    }
    if (cause.response?.status === 404) {
      return "Assistant API is missing on the server. Restart Symphony to load the latest routes.";
    }
    if (cause.message) return cause.message;
  }

  if (cause instanceof Error && cause.message) return cause.message;
  return fallback;
}

function normalizeAssistantEffort(dto: BackendAssistantEffortDto): AssistantEffortOption {
  const id = dto.id ?? "";
  return {
    id,
    label: dto.label ?? id,
    description: dto.description ?? undefined,
  };
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
    arguments: dto.arguments ?? null,
    output: typeof dto.output === "string" ? dto.output : null,
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
