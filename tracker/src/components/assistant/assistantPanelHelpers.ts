import type { TFunction } from "i18next";

import type { AssistantComposerSubmit } from "@/components/assistant/AssistantComposer";
import { assistantMessage } from "@/components/assistant/assistantStream";
import type { ComposerContextChipRef } from "@/components/assistant/contextMentions";
import { i18n } from "@/i18n";
import { extractKbDocumentReferencesFromMarkdown } from "@/lib/assistantKbReferences";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import type { AssistantChatMessage, AssistantToolCall } from "@/services/assistant";
import type { AssistantApprovalRequest } from "@/services/phoenix/assistantChannel";
import type { AgentKind } from "@/types/issue";

export interface DraftIssueCreated {
  identifier: string;
}

export function contextRefForApprovalRequest(request: AssistantApprovalRequest, t: TFunction): ComposerContextChipRef {
  const requestId = String(request.requestId);
  const content = [
    "### Agent permission request",
    "",
    request.command ? "#### Command" : null,
    request.command ? ["```shell", request.command, "```"].join("\n") : null,
    request.cwd ? `- Working directory: ${request.cwd}` : null,
    request.reason ? `- Detected action: ${request.reason}` : null,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");

  return {
    type: "security",
    id: `permission:${requestId}`,
    label: t("assistant.panel.commandApproval.title", { agent: agentDisplayName(request.agent) }),
    detail: request.cwd ?? request.reason ?? requestId,
    content,
    state: "draft",
  };
}

export function displayMessages(messages: AssistantChatMessage[], t: TFunction): AssistantChatMessage[] {
  if (messages.length > 0) return messages;

  return [assistantMessage("assistant-welcome", t("assistant.panel.welcome"))];
}

export function latestPendingPlanMessageId(
  messages: AssistantChatMessage[],
  approvedIds: ReadonlySet<string>,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") return null;
    if (message.role !== "assistant" || approvedIds.has(message.id)) continue;
    if (message.toolCalls.some(isPendingPlanToolCall)) return message.id;
  }

  return null;
}

function isPendingPlanToolCall(toolCall: AssistantToolCall): boolean {
  if (toolCall.name !== "update_plan") return false;

  const plan = planItemsFromToolCall(toolCall);
  if (plan.length === 0) return true;

  return plan.some((item) => itemStatus(item) !== "completed");
}

function planItemsFromToolCall(toolCall: AssistantToolCall): Record<string, unknown>[] {
  const sources = [toolCall.arguments, toolCall.result].filter(
    (source): source is Record<string, unknown> => source != null && typeof source === "object" && !Array.isArray(source),
  );

  for (const source of sources) {
    if (Array.isArray(source.plan)) {
      return source.plan.filter(
        (item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item),
      );
    }
  }

  return [];
}

function itemStatus(item: Record<string, unknown>): string {
  return typeof item.status === "string" ? item.status.toLowerCase() : "";
}

/**
 * Only small tool arguments are scanned for KB references. Tool `output` and `result`
 * are intentionally excluded: shell dumps reach ~1 MB and previously caused multi-second
 * main-thread freezes during streaming and history reveal.
 */
const MAX_TOOL_ARGS_SCAN_LENGTH = 4096;
const MARKDOWN_MARKER_RE = /\.md/i;
const MAX_REFERENCE_CACHE_ENTRIES = 512;

interface CachedMessageReferences {
  key: string;
  references: string[];
}

const messageReferenceCache = new Map<string, CachedMessageReferences>();

export function extractKbDocumentReferencesFromMessage(message: AssistantChatMessage): string[] {
  const scannableText = scannableReferenceText(message);
  const cached = messageReferenceCache.get(message.id);
  if (cached && cached.key === scannableText) return cached.references;

  const references = extractKbDocumentReferencesFromMarkdown(scannableText);
  storeMessageReferences(message.id, scannableText, references);

  return references;
}

function storeMessageReferences(messageId: string, key: string, references: string[]): void {
  if (messageReferenceCache.size >= MAX_REFERENCE_CACHE_ENTRIES && !messageReferenceCache.has(messageId)) {
    const oldestKey = messageReferenceCache.keys().next().value;
    if (oldestKey !== undefined) messageReferenceCache.delete(oldestKey);
  }
  messageReferenceCache.set(messageId, { key, references });
}

function scannableReferenceText(message: AssistantChatMessage): string {
  const parts = [message.content];

  for (const toolCall of message.toolCalls) {
    const serializedArguments = scannableToolArguments(toolCall);
    if (serializedArguments) parts.push(serializedArguments);
  }

  return parts.join("\n");
}

function scannableToolArguments(toolCall: AssistantToolCall): string | null {
  const serialized = safeJsonStringify(toolCall.arguments);
  if (!serialized || serialized.length > MAX_TOOL_ARGS_SCAN_LENGTH) return null;
  if (!MARKDOWN_MARKER_RE.test(serialized)) return null;

  return serialized;
}

function safeJsonStringify(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

export function fallbackAttachmentMessage(
  attachments: AssistantComposerSubmit["attachments"],
  t: TFunction,
): string {
  if (attachments.some((attachment) => attachment.type === "audio")) {
    return t("assistant.panel.attachmentFallback.audio");
  }
  if (attachments.some((attachment) => attachment.type === "image")) {
    return t("assistant.panel.attachmentFallback.image");
  }
  return t("assistant.panel.attachmentFallback.files");
}

export function draftIssueCreatedFromMessage(message: AssistantChatMessage): DraftIssueCreated | null {
  for (const toolCall of message.toolCalls) {
    if (toolCall.status !== "complete") continue;
    if (!isCreateDraftIssueToolCall(toolCall)) continue;

    const identifier =
      extractIssueIdentifier(toolCall.result.issue) ??
      extractIssueIdentifier(toolCall.result.data) ??
      extractIssueIdentifier(toolCall.result);
    if (identifier) return { identifier };
  }

  return null;
}

function isCreateDraftIssueToolCall(toolCall: AssistantToolCall): boolean {
  return toolCall.name === "create_draft_issue" || stringFromRecord(toolCall.result, "tool") === "create_draft_issue";
}

function extractIssueIdentifier(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const identifier =
    stringFromRecord(record, "identifier") ??
    stringFromRecord(record, "issueIdentifier") ??
    stringFromRecord(record, "issue_identifier");
  const normalized = identifier ? normalizeIssueIdentifier(identifier) : "";
  if (normalized) return normalized;

  return extractIssueIdentifier(record.issue) ?? extractIssueIdentifier(record.data);
}

export function goalModeFromResponse(response: unknown): boolean | null {
  if (!response || typeof response !== "object") return null;
  const record = response as Record<string, unknown>;
  const value = record.goal_mode ?? record.enabled;
  return typeof value === "boolean" ? value : null;
}

export function effectiveAgentFromResponse(response: unknown): AgentKind | null {
  if (!response || typeof response !== "object") return null;
  const value = (response as Record<string, unknown>).effective_agent;
  return normalizeAgentSeed(value);
}

export function modelFromResponse(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  return stringFromRecord(response as Record<string, unknown>, "model");
}

export function effortFromResponse(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  return stringFromRecord(response as Record<string, unknown>, "effort");
}

export function normalizeAgentSeed(value: unknown): AgentKind | null {
  if (value === "claude" || value === "codex" || value === "cursor") return value;
  return null;
}

export function agentDisplayName(agent: AgentKind | null): string {
  if (agent === "claude") return "Claude";
  if (agent === "cursor") return "Cursor";
  return "Codex";
}

export function messageFromResponse(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  return stringFromRecord(response as Record<string, unknown>, "message");
}

function stringFromRecord(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

export function errorMessage(reason: unknown, t: TFunction = i18n.t.bind(i18n) as TFunction): string {
  if (reason && typeof reason === "object" && "reason" in reason && typeof reason.reason === "string") return reason.reason;
  if (reason instanceof Error) return reason.message;
  return t("assistant.panel.requestFailed");
}
