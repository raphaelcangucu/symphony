import axios from "axios";

import {
  catalogAgentLabel,
  fallbackCatalogBundle,
  fallbackClaudeCatalog,
  fallbackCodexCatalog,
  fallbackCursorCatalog,
  fallbackOpenCodeCatalog,
  loadCachedCatalogBundle,
  saveCachedCatalogBundle,
  type AssistantAgentCatalog,
  type AssistantCatalogBundle,
  type AssistantCodexCatalog,
  type AssistantEffortOption,
  type AssistantModelOption,
} from "@/lib/assistantSettings";
import { i18n } from "@/i18n";
import { requireProjectSlug } from "@/lib/serviceValidation";
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
  id: string | null;
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

export type AssistantContentBlock = { type: "text"; text: string } | { type: "tool"; toolCallId: string };

export interface AssistantChatMessage {
  id: string;
  role: AssistantChatRole;
  content: string;
  contentBlocks?: AssistantContentBlock[];
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
  id?: string | number | null;
  call_id?: string | number | null;
  callId?: string | number | null;
  tool_use_id?: string | number | null;
  toolUseId?: string | number | null;
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
  content_blocks?: unknown;
  contentBlocks?: unknown;
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
  const slug = requireProjectSlug(projectSlug);

  const form = new FormData();
  form.append("file", file);

  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(slug)}/assistant/attachments`), form, {
    headers: { "Content-Type": "multipart/form-data" },
  });

  const dto = unwrapData<BackendUploadedAttachmentDto>(response);
  const path = dto.path?.trim();
  if (!path) throw new Error(i18n.t("project.services.validation.uploadPathMissing"));

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
  const slug = requireProjectSlug(projectSlug);

  try {
    const response = await http.get(trackerPath(`/projects/${encodeURIComponent(slug)}/assistant/config`));
    const raw = unwrapData<BackendAssistantCatalogBundleDto>(response);
    const bundle = normalizeAssistantCatalogBundle(raw);
    saveCachedCatalogBundle(bundle);
    return bundle;
  } catch (cause) {
    if (axios.isAxiosError(cause) && cause.response?.status === 404) {
      throw new Error(i18n.t("assistant.catalog.errors.apiMissing"));
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

    throw new Error(extractApiErrorMessage(cause, i18n.t("assistant.catalog.errors.loadFailed")));
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
    throw new Error(i18n.t("assistant.catalog.errors.noCodexModels"));
  }

  return {
    agent: "codex",
    agentLabel: dto.agentLabel ?? dto.agent_label ?? catalogAgentLabel("codex"),
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
      if (agentKind !== "codex" && agentKind !== "claude" && agentKind !== "cursor" && agentKind !== "opencode") return null;

      const models = (agentDto.models ?? []).map(normalizeAssistantModel).filter((m) => m.model.length > 0);
      if (models.length === 0) {
        if (agentKind === "claude") return fallbackClaudeCatalog();
        if (agentKind === "cursor") return fallbackCursorCatalog();
        if (agentKind === "opencode") return fallbackOpenCodeCatalog();
        return fallbackCodexCatalog();
      }

      const fallbackCommands: Record<AgentKind, string> = {
        codex: "codex app-server",
        claude: "claude",
        cursor: "cursor-agent",
        opencode: "opencode",
      };

      return {
        agent: agentKind as AgentKind,
        agentLabel: agentDto.agentLabel ?? agentDto.agent_label ?? catalogAgentLabel(agentKind),
        command: agentDto.command ?? fallbackCommands[agentKind],
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
    rawDefault === "codex" || rawDefault === "claude" || rawDefault === "cursor"
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
      return i18n.t("assistant.catalog.errors.apiMissing");
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
  const slug = requireProjectSlug(projectSlug);
  const message = input.message.trim();
  if (!message) throw new Error(i18n.t("project.services.validation.fieldRequired", { field: "message" }));

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
  const metadata = isObjectRecord(dto.metadata) ? dto.metadata : {};

  return {
    id: String(dto.id ?? `assistant-message-${dto.sequence ?? cryptoRandomId()}`),
    role: normalizeRole(dto.role),
    content: dto.content ?? "",
    contentBlocks: normalizeAssistantContentBlocks(dto, metadata),
    toolCalls: (dto.toolCalls ?? dto.tool_calls ?? []).map(normalizeToolCall),
    turnId: dto.turnId ?? dto.turn_id ?? null,
    sequence: dto.sequence ?? null,
    insertedAt: dto.insertedAt ?? dto.inserted_at ?? null,
    metadata,
  };
}

function normalizeAssistantContentBlocks(
  dto: BackendAssistantChatMessageDto,
  metadata: Record<string, unknown>,
): AssistantContentBlock[] | undefined {
  return (
    normalizeContentBlockCandidates([dto.contentBlocks, dto.content_blocks]) ??
    normalizeContentBlockCandidates([metadata.contentBlocks, metadata.content_blocks])
  );
}

function normalizeContentBlockCandidates(candidates: readonly unknown[]): AssistantContentBlock[] | undefined {
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;

    const contentBlocks = normalizeContentBlockRows(candidate);
    if (contentBlocks) return contentBlocks;
  }

  return undefined;
}

function normalizeContentBlockRows(rows: readonly unknown[]): AssistantContentBlock[] | undefined {
  const contentBlocks: AssistantContentBlock[] = [];
  const seenToolCallIds = new Set<string>();

  for (const row of rows) {
    if (!isObjectRecord(row)) continue;

    if (row.type === "text") {
      if (typeof row.text !== "string" || row.text.length === 0) continue;

      const previousBlock = contentBlocks[contentBlocks.length - 1];
      if (previousBlock?.type === "text") {
        contentBlocks[contentBlocks.length - 1] = { type: "text", text: `${previousBlock.text}${row.text}` };
      } else {
        contentBlocks.push({ type: "text", text: row.text });
      }
      continue;
    }

    if (row.type !== "tool") continue;

    const toolCallId = readContentBlockToolCallId(row);
    if (!toolCallId || seenToolCallIds.has(toolCallId)) continue;

    seenToolCallIds.add(toolCallId);
    contentBlocks.push({ type: "tool", toolCallId });
  }

  return contentBlocks.length > 0 ? contentBlocks : undefined;
}

function readContentBlockToolCallId(row: Record<string, unknown>): string | undefined {
  const camelToolCallId = row.toolCallId;
  if (typeof camelToolCallId === "string" && camelToolCallId.trim() !== "") return camelToolCallId;

  const snakeToolCallId = row.tool_call_id;
  if (typeof snakeToolCallId === "string" && snakeToolCallId.trim() !== "") return snakeToolCallId;
  return undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeToolCall(dto: BackendAssistantToolCallDto): AssistantToolCall {
  const result = dto.result ?? {};

  return {
    id: normalizeToolCallId(dto),
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

function normalizeToolCallId(dto: BackendAssistantToolCallDto): string | null {
  const raw = dto.id ?? dto.call_id ?? dto.callId ?? dto.tool_use_id ?? dto.toolUseId;
  if (typeof raw === "string" && raw.trim() !== "") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
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
