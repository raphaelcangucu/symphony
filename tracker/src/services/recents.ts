import type { RecentKind, RecentScope, RecentSession, RecentStatusKind } from "@/types/recents";

import { http, trackerPath, unwrapData } from "./http";

export interface BackendRecentItemDto {
  id: string;
  kind: string;
  scope?: string | null;
  project_slug?: string | null;
  project_name?: string | null;
  agent_kind?: string | null;
  title: string;
  identifier?: string | null;
  thread_id?: number | null;
  status: string;
  status_kind?: string | null;
  preview?: string | null;
  updated_at?: string | null;
}

const KNOWN_STATUS_KINDS: readonly RecentStatusKind[] = [
  "running", "waiting", "retrying", "idle", "active", "closed", "error", "aborted", "done", "in_progress", "todo",
];

function normalizeStatusKind(value: string | null | undefined): RecentStatusKind {
  return KNOWN_STATUS_KINDS.includes(value as RecentStatusKind) ? (value as RecentStatusKind) : "active";
}

function normalizeKind(value: string): RecentKind {
  return value === "codex" ? "codex" : "chat";
}

function normalizeAgentKind(value: string | null | undefined): RecentSession["agentKind"] {
  return value === "codex" || value === "claude" || value === "cursor" || value === "opencode" ? value : null;
}

function normalizeScope(value: string | null | undefined): RecentScope {
  if (
    value === "project" ||
    value === "project_session" ||
    value === "project_explore" ||
    value === "freeform" ||
    value === "issue" ||
    value === "issue_session" ||
    value === "issue_execution"
  ) {
    return value;
  }
  return null;
}

export function normalizeRecentSession(dto: BackendRecentItemDto): RecentSession {
  return {
    id: dto.id,
    kind: normalizeKind(dto.kind),
    scope: normalizeScope(dto.scope),
    agentKind: normalizeAgentKind(dto.agent_kind),
    projectSlug: dto.project_slug ?? null,
    projectName: dto.project_name ?? null,
    title: dto.title,
    identifier: dto.identifier ?? null,
    threadId: dto.thread_id ?? null,
    status: dto.status,
    statusKind: normalizeStatusKind(dto.status_kind),
    preview: dto.preview ?? null,
    updatedAt: dto.updated_at ?? "",
  };
}

export async function listRecents(limit = 20): Promise<RecentSession[]> {
  const response = await http.get(trackerPath(`/recents?limit=${encodeURIComponent(String(limit))}`));
  return unwrapData<BackendRecentItemDto[]>(response).map(normalizeRecentSession);
}
