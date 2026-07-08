import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import type { Blocker, BlockerState } from "@/types/blocker";
import type { Comment, CommentSyncStatus } from "@/types/comment";

import { maybeString, type BackendId } from "./shared";

export interface BackendCommentDto {
  id: BackendId;
  issue_identifier?: string | null;
  issueIdentifier?: string | null;
  issue_id?: BackendId | null;
  body: string;
  author?: string | null;
  kind?: string | null;
  url?: string | null;
  sync_status?: string | null;
  syncStatus?: string | null;
  inserted_at?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
}

export interface BackendBlockerDto {
  id: BackendId;
  type?: string | null;
  source_identifier?: string | null;
  sourceIdentifier?: string | null;
  target_identifier?: string | null;
  targetIdentifier?: string | null;
  state?: BlockerState | string | null;
  reason?: string | null;
  inserted_at?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
}

export function normalizeComment(dto: BackendCommentDto, fallbackIssueIdentifier?: string | null): Comment {
  return {
    id: String(dto.id),
    issueIdentifier: normalizeIssueIdentifier(
      dto.issueIdentifier ?? dto.issue_identifier ?? fallbackIssueIdentifier ?? maybeString(dto.issue_id) ?? "",
    ),
    author: dto.author ?? null,
    body: dto.body,
    kind: dto.kind ?? null,
    url: dto.url ?? null,
    syncStatus: normalizeCommentSyncStatus(dto.syncStatus ?? dto.sync_status),
    createdAt: dto.createdAt ?? dto.created_at ?? dto.inserted_at ?? "",
    updatedAt: dto.updatedAt ?? dto.updated_at ?? dto.inserted_at ?? "",
  };
}

const COMMENT_SYNC_STATUSES: readonly CommentSyncStatus[] = ["synced", "pending", "conflict", "error", "archived"];

function normalizeCommentSyncStatus(value?: string | null): CommentSyncStatus | null {
  return (COMMENT_SYNC_STATUSES as readonly string[]).includes(value ?? "") ? (value as CommentSyncStatus) : null;
}

export function normalizeBlocker(dto: BackendBlockerDto, fallbackIssueIdentifier?: string | null): Blocker {
  const createdAt = dto.createdAt ?? dto.created_at ?? dto.inserted_at ?? "";

  return {
    id: String(dto.id),
    issueIdentifier: normalizeIssueIdentifier(dto.sourceIdentifier ?? dto.source_identifier ?? fallbackIssueIdentifier ?? ""),
    blockingIssueIdentifier: normalizeOptionalIssueIdentifier(dto.targetIdentifier ?? dto.target_identifier),
    reason: dto.reason ?? dto.type ?? "blocked_by",
    state: normalizeBlockerState(dto.state),
    createdAt,
    updatedAt: dto.updatedAt ?? dto.updated_at ?? createdAt,
  };
}

function normalizeBlockerState(state: BackendBlockerDto["state"]): BlockerState {
  if (state === "resolved" || state === "canceled") return state;
  return "open";
}

function normalizeOptionalIssueIdentifier(identifier: string | null | undefined): string | null {
  const normalized = normalizeIssueIdentifier(identifier);
  return normalized || null;
}
