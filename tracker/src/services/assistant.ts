import axios from "axios";

import {
  catalogAgentLabel,
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
  /** True when `output` is a server-truncated preview; full text is fetchable on demand. */
  outputTruncated?: boolean;
  /** Original (untruncated) output size in bytes, when the server capped it. */
  outputByteSize?: number | null;
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

export type AssistantContentBlock =
  { type: "text"; text: string } | { type: "tool"; toolCallId: string };

export interface AssistantChatMessage {
  id: string;
  role: AssistantChatRole;
  content: string;
  contentBlocks?: AssistantContentBlock[];
  toolCalls: AssistantToolCall[];
  runId?: string | null;
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
  questions?: unknown;
}): UserQuestionsRequest | null {
  const requestId = payload.request_id;
  if (requestId == null) return null;

  const rawQuestions = Array.isArray(payload.questions)
    ? payload.questions
    : [];
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
              if (typeof o.description === "string")
                option.description = o.description;
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

// Backend DTOs mirror the Elixir/Phoenix wire format, which is snake_case over
// both HTTP and the assistant channel. `id`, `call_id`, and `tool_use_id` are
// distinct provider-specific keys (not case variants).
interface BackendAssistantToolCallDto {
  id?: string | number | null;
  call_id?: string | number | null;
  tool_use_id?: string | number | null;
  name?: string | null;
  status?: string | null;
  arguments?: Record<string, unknown> | null;
  output?: string | null;
  output_truncated?: boolean | null;
  output_byte_size?: number | null;
  result?: {
    issue?: BackendIssueDto | null;
    issues?: BackendIssueDto[] | null;
    comment?: BackendCommentDto | null;
    agent_executions?: unknown[] | null;
    [key: string]: unknown;
  } | null;
}

interface BackendAssistantMessageDto {
  assistant_message?: string | null;
  tool_calls?: BackendAssistantToolCallDto[] | null;
}

export interface BackendAssistantChatMessageDto {
  id?: string | number | null;
  role?: string | null;
  content?: string | null;
  content_blocks?: unknown;
  tool_calls?: BackendAssistantToolCallDto[] | null;
  run_id?: string | null;
  sequence?: number | null;
  inserted_at?: string | null;
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
  default_effort?: string | null;
  efforts?: BackendAssistantEffortDto[] | null;
  input_modalities?: string[] | null;
}

interface BackendAssistantCodexCatalogDto {
  agent?: string | null;
  agent_label?: string | null;
  command?: string | null;
  default_model?: string | null;
  models?: BackendAssistantModelDto[] | null;
}

interface BackendAssistantCatalogBundleDto {
  agents?: BackendAssistantCodexCatalogDto[] | null;
  default_agent?: string | null;
}

interface BackendUploadedAttachmentDto {
  id?: string | null;
  type?: string | null;
  name?: string | null;
  media_type?: string | null;
  path?: string | null;
  size_bytes?: number | null;
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

  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(slug)}/assistant/attachments`),
    form,
    {
      headers: { "Content-Type": "multipart/form-data" },
    },
  );

  const dto = unwrapData<BackendUploadedAttachmentDto>(response);
  const path = dto.path?.trim();
  if (!path)
    throw new Error(i18n.t("project.services.validation.uploadPathMissing"));

  return {
    id: dto.id ?? path,
    type: dto.type === "file" ? "file" : "image",
    name: dto.name ?? file.name,
    mediaType: dto.media_type ?? file.type,
    path,
    sizeBytes: dto.size_bytes ?? undefined,
  };
}

export async function fetchAssistantCatalogBundle(
  projectSlug?: string | null,
  signal?: AbortSignal,
): Promise<AssistantCatalogBundle> {
  const slug = projectSlug?.trim() || null;
  return refreshAssistantCatalogBundle(slug, signal);
}

async function refreshAssistantCatalogBundle(
  slug: string | null,
  signal?: AbortSignal,
): Promise<AssistantCatalogBundle> {
  try {
    const path = slug
      ? `/projects/${encodeURIComponent(slug)}/assistant/config`
      : "/assistant/config";
    const response = await http.get(
      trackerPath(path),
      { signal },
    );
    const raw = unwrapData<BackendAssistantCatalogBundleDto>(response);
    return normalizeAssistantCatalogBundle(raw);
  } catch (cause) {
    if (axios.isAxiosError(cause) && cause.response?.status === 404) {
      throw new Error(i18n.t("assistant.catalog.errors.apiMissing"));
    }

    throw new Error(
      extractApiErrorMessage(
        cause,
        i18n.t("assistant.catalog.errors.loadFailed"),
      ),
    );
  }
}

/**
 * @deprecated Use fetchAssistantCatalogBundle. Returns only the codex catalog
 * for callers that haven't been updated yet.
 */
export async function fetchAssistantCodexCatalog(
  projectSlug: string,
): Promise<AssistantCodexCatalog> {
  const bundle = await fetchAssistantCatalogBundle(projectSlug);
  const catalog = bundle.agents.find((candidate) => candidate.agent === "codex");
  if (!catalog) {
    throw new Error(i18n.t("assistant.catalog.errors.noCodexModels"));
  }
  return catalog;
}

export function normalizeAssistantCodexCatalog(
  dto: BackendAssistantCodexCatalogDto,
): AssistantCodexCatalog {
  const models = (dto.models ?? [])
    .map(normalizeAssistantModel)
    .filter((model) => model.model.length > 0);

  if (models.length === 0) {
    throw new Error(i18n.t("assistant.catalog.errors.noCodexModels"));
  }
  const command = dto.command?.trim();
  if (!command) {
    throw new Error(i18n.t("assistant.catalog.errors.loadFailed"));
  }
  const defaultModel = dto.default_model?.trim();
  if (!defaultModel || !models.some((model) => model.model === defaultModel)) {
    throw new Error(i18n.t("assistant.catalog.errors.loadFailed"));
  }

  return {
    agent: "codex",
    agentLabel: dto.agent_label ?? catalogAgentLabel("codex"),
    command,
    defaultModel,
    models,
  };
}

export function normalizeAssistantCatalogBundle(
  dto: BackendAssistantCatalogBundleDto,
): AssistantCatalogBundle {
  const rawAgents = Array.isArray(dto.agents) ? dto.agents : [];

  const agents: AssistantAgentCatalog[] = rawAgents
    .map((agentDto): AssistantAgentCatalog | null => {
      const agentKind = agentDto.agent;
      if (
        agentKind !== "codex" &&
        agentKind !== "claude" &&
        agentKind !== "cursor" &&
        agentKind !== "opencode"
      )
        return null;

      const models = (agentDto.models ?? [])
        .map(normalizeAssistantModel)
        .filter((m) => m.model.length > 0);
      if (models.length === 0) return null;

      const command = agentDto.command?.trim();
      if (!command) return null;
      const defaultModel = agentDto.default_model?.trim();
      if (
        !defaultModel ||
        !models.some((model) => model.model === defaultModel)
      ) {
        return null;
      }

      return {
        agent: agentKind as AgentKind,
        agentLabel: agentDto.agent_label ?? catalogAgentLabel(agentKind),
        command,
        defaultModel,
        models,
      };
    })
    .filter((a): a is AssistantAgentCatalog => a !== null);

  if (agents.length === 0) {
    throw new Error(i18n.t("assistant.catalog.errors.noModels"));
  }

  const rawDefault = dto.default_agent;
  if (
    rawDefault !== "codex" &&
    rawDefault !== "claude" &&
    rawDefault !== "cursor" &&
    rawDefault !== "opencode"
  ) {
    throw new Error(i18n.t("assistant.catalog.errors.loadFailed"));
  }
  const defaultAgent = rawDefault;
  if (!agents.some((agent) => agent.agent === defaultAgent)) {
    throw new Error(i18n.t("assistant.catalog.errors.loadFailed"));
  }

  return { agents, defaultAgent };
}

function normalizeAssistantModel(
  dto: BackendAssistantModelDto,
): AssistantModelOption {
  const model = dto.model ?? "";
  const efforts = (dto.efforts ?? [])
    .map(normalizeAssistantEffort)
    .filter((effort) => effort.id.length > 0);
  const defaultEffort = dto.default_effort ?? "";
  if (
    defaultEffort &&
    !efforts.some((effort) => effort.id === defaultEffort)
  ) {
    throw new Error(
      `assistant catalog default effort ${defaultEffort} is not advertised by model ${model}`,
    );
  }

  return {
    id: model,
    model,
    label: dto.label ?? model,
    description: dto.description ?? undefined,
    isDefault: dto.is_default ?? false,
    defaultEffort,
    efforts,
    inputModalities: dto.input_modalities ?? undefined,
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

function normalizeAssistantEffort(
  dto: BackendAssistantEffortDto,
): AssistantEffortOption {
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
  if (!message)
    throw new Error(
      i18n.t("project.services.validation.fieldRequired", { field: "message" }),
    );

  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(slug)}/assistant/messages`),
    {
      message,
      context: input.context ?? {},
    },
  );

  return normalizeAssistantMessage(
    unwrapData<BackendAssistantMessageDto>(response),
  );
}

export function normalizeAssistantMessage(
  dto: BackendAssistantMessageDto,
): AssistantMessageResponse {
  return {
    assistantMessage: dto.assistant_message ?? "",
    toolCalls: (dto.tool_calls ?? []).map(normalizeToolCall),
  };
}

export function normalizeAssistantChatMessage(
  dto: BackendAssistantChatMessageDto,
): AssistantChatMessage {
  const metadata = isObjectRecord(dto.metadata) ? dto.metadata : {};

  return {
    id: String(
      dto.id ?? `assistant-message-${dto.sequence ?? cryptoRandomId()}`,
    ),
    role: normalizeRole(dto.role),
    content: dto.content ?? "",
    contentBlocks: normalizeAssistantContentBlocks(dto, metadata),
    toolCalls: (dto.tool_calls ?? []).map(normalizeToolCall),
    runId: dto.run_id ?? null,
    sequence: dto.sequence ?? null,
    insertedAt: dto.inserted_at ?? null,
    metadata,
  };
}

function normalizeAssistantContentBlocks(
  dto: BackendAssistantChatMessageDto,
  metadata: Record<string, unknown>,
): AssistantContentBlock[] | undefined {
  const topLevelField = selectPresentContentBlocksField(dto);
  if (topLevelField.isPresent)
    return normalizeContentBlockValue(topLevelField.value);

  const legacyMetadataField = selectPresentContentBlocksField(metadata);
  return legacyMetadataField.isPresent
    ? normalizeContentBlockValue(legacyMetadataField.value)
    : undefined;
}

type SelectedContentBlocksField =
  { isPresent: true; value: unknown } | { isPresent: false };

function selectPresentContentBlocksField(source: {
  content_blocks?: unknown;
}): SelectedContentBlocksField {
  if (Object.prototype.hasOwnProperty.call(source, "content_blocks")) {
    return { isPresent: true, value: source.content_blocks };
  }
  return { isPresent: false };
}

function normalizeContentBlockValue(
  value: unknown,
): AssistantContentBlock[] | undefined {
  return Array.isArray(value) ? normalizeContentBlockRows(value) : undefined;
}

function normalizeContentBlockRows(
  rows: readonly unknown[],
): AssistantContentBlock[] | undefined {
  const contentBlocks: AssistantContentBlock[] = [];
  const seenToolCallIds = new Set<string>();

  for (const row of rows) {
    if (!isObjectRecord(row)) continue;

    if (row.type === "text") {
      if (typeof row.text !== "string" || row.text.length === 0) continue;

      const previousBlock = contentBlocks[contentBlocks.length - 1];
      if (previousBlock?.type === "text") {
        contentBlocks[contentBlocks.length - 1] = {
          type: "text",
          text: `${previousBlock.text}${row.text}`,
        };
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

function readContentBlockToolCallId(
  row: Record<string, unknown>,
): string | undefined {
  const toolCallId = row.tool_call_id;
  if (typeof toolCallId === "string" && toolCallId.trim() !== "")
    return toolCallId;
  return undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeToolCall(
  dto: BackendAssistantToolCallDto,
): AssistantToolCall {
  const result = dto.result ?? {};

  return {
    id: normalizeToolCallId(dto),
    name: dto.name ?? "unknown",
    status: normalizeToolStatus(dto.status),
    arguments: dto.arguments ?? null,
    output: typeof dto.output === "string" ? dto.output : null,
    outputTruncated: dto.output_truncated === true,
    outputByteSize:
      typeof dto.output_byte_size === "number" ? dto.output_byte_size : null,
    result: {
      ...result,
      issue: result.issue ? normalizeIssue(result.issue) : undefined,
      issues: Array.isArray(result.issues)
        ? result.issues.map(normalizeIssue)
        : undefined,
      comment: result.comment ? normalizeComment(result.comment) : undefined,
      agentExecutions: result.agent_executions ?? undefined,
    },
  };
}

function normalizeToolCallId(dto: BackendAssistantToolCallDto): string | null {
  const candidates = [dto.id, dto.call_id, dto.tool_use_id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "")
      return candidate;
    if (typeof candidate === "number" && Number.isFinite(candidate))
      return String(candidate);
  }

  return null;
}

function normalizeToolStatus(
  status: string | null | undefined,
): AssistantToolStatus {
  if (status === "running" || status === "complete" || status === "error")
    return status;
  return "complete";
}

function normalizeRole(role: string | null | undefined): AssistantChatRole {
  if (
    role === "user" ||
    role === "assistant" ||
    role === "tool" ||
    role === "system"
  )
    return role;
  return "assistant";
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}
