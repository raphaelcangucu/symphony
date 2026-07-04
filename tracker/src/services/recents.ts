import type { RecentKind, RecentScope, RecentSession, RecentStatusKind } from "@/types/recents";

import { http, trackerPath, unwrapData } from "./http";

export interface BackendRecentItemDto {
  id: string;
  kind: string;
  scope?: string | null;
  project_slug?: string | null;
  projectSlug?: string | null;
  project_name?: string | null;
  projectName?: string | null;
  agent_kind?: string | null;
  agentKind?: string | null;
  title: string;
  identifier?: string | null;
  thread_id?: number | null;
  threadId?: number | null;
  status: string;
  status_kind?: string | null;
  statusKind?: string | null;
  preview?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
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
  return value === "codex" || value === "claude" || value === "cursor" ? value : null;
}

function normalizeScope(value: string | null | undefined): RecentScope {
  if (value === "project" || value === "project_session" || value === "project_explore" || value === "freeform" || value === "issue") return value;
  return null;
}

export function normalizeRecentSession(dto: BackendRecentItemDto): RecentSession {
  return {
    id: dto.id,
    kind: normalizeKind(dto.kind),
    scope: normalizeScope(dto.scope),
    agentKind: normalizeAgentKind(dto.agentKind ?? dto.agent_kind),
    projectSlug: dto.projectSlug ?? dto.project_slug ?? null,
    projectName: dto.projectName ?? dto.project_name ?? null,
    title: dto.title,
    identifier: dto.identifier ?? null,
    threadId: dto.threadId ?? dto.thread_id ?? null,
    status: dto.status,
    statusKind: normalizeStatusKind(dto.statusKind ?? dto.status_kind),
    preview: dto.preview ?? null,
    updatedAt: dto.updatedAt ?? dto.updated_at ?? "",
  };
}

export async function listRecents(limit = 20): Promise<RecentSession[]> {
  const response = await http.get(trackerPath(`/recents?limit=${encodeURIComponent(String(limit))}`));
  return unwrapData<BackendRecentItemDto[]>(response).map(normalizeRecentSession);
}
