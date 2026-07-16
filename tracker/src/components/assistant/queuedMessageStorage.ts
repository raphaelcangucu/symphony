import type { AssistantComposerSubmit } from "@/components/assistant/AssistantComposer";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";

export interface StoredQueuedMessage {
  id: string;
  payload: AssistantComposerSubmit;
}

export interface QueuedMessageStorageScope {
  threadId?: number | null;
  issueIdentifier?: string;
  projectSlug?: string;
}

const STORAGE_PREFIX = "symphony.assistant.queued.";

export function queuedMessagesStorageKey(scope: QueuedMessageStorageScope): string | null {
  if (scope.threadId != null && Number.isFinite(scope.threadId)) {
    return `${STORAGE_PREFIX}thread.${scope.threadId}`;
  }

  const issueIdentifier = scope.issueIdentifier?.trim();
  if (issueIdentifier) {
    const project = scope.projectSlug?.trim() || "_";
    return `${STORAGE_PREFIX}issue.${project}.${normalizeIssueIdentifier(issueIdentifier)}`;
  }

  const projectSlug = scope.projectSlug?.trim();
  if (projectSlug) {
    return `${STORAGE_PREFIX}project.${projectSlug}`;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isStoredQueuedMessage(value: unknown): value is StoredQueuedMessage {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (!isRecord(value.payload)) return false;
  if (typeof value.payload.message !== "string") return false;
  if (typeof value.payload.kind !== "string") return false;
  return true;
}

export function readQueuedMessages(storageKey: string | null): StoredQueuedMessage[] {
  if (!storageKey || typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredQueuedMessage);
  } catch {
    return [];
  }
}

export function writeQueuedMessages(storageKey: string | null, items: StoredQueuedMessage[]): void {
  if (!storageKey || typeof window === "undefined") return;

  try {
    if (items.length === 0) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(items));
  } catch {
    // Quota / private mode — queue remains in-memory for the session.
  }
}
