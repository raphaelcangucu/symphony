import { requireProjectSlug } from "@/lib/serviceValidation";
import type { AgentKind } from "@/types/issue";
import type { ProjectSessionKind, ProjectSessionRow, ProjectSessionsPage } from "@/types/project-session";

import { http, trackerPath } from "./http";

const DEFAULT_LIMIT = 20;

const KNOWN_SESSION_KINDS: readonly ProjectSessionKind[] = [
  "execution",
  "authoring",
  "chat",
  "workspace_session",
  "issue",
];

const KNOWN_AGENT_KINDS: readonly AgentKind[] = ["codex", "claude", "cursor", "opencode"];

export interface BackendProjectSessionRowDto {
  id: string;
  title: string | null;
  kind: string;
  href: string;
  updated_at?: string | null;
  updatedAt?: string | null;
  aggregate_status?: string | null;
  aggregateStatus?: string | null;
  agent_kind?: string | null;
  agentKind?: string | null;
  issue_identifier?: string | null;
  issueIdentifier?: string | null;
  workspace_path?: string | null;
  workspacePath?: string | null;
  workspace_id?: string | null;
  workspaceId?: string | null;
  pinned?: boolean;
  archived?: boolean;
}

export interface BackendProjectSessionsMetaDto {
  next_cursor?: string | null;
  nextCursor?: string | null;
  project_activity_at?: string | null;
  projectActivityAt?: string | null;
}

export interface BackendProjectSessionsPageDto {
  data: BackendProjectSessionRowDto[];
  meta?: BackendProjectSessionsMetaDto;
}

export interface ListProjectSessionsInput {
  projectSlug: string;
  limit?: number;
  cursor?: string;
  includeArchived?: boolean;
}

function normalizeSessionKind(value: string): ProjectSessionKind {
  return KNOWN_SESSION_KINDS.includes(value as ProjectSessionKind) ? (value as ProjectSessionKind) : "chat";
}

function normalizeAgentKind(value: string | null | undefined): AgentKind | null {
  return KNOWN_AGENT_KINDS.includes(value as AgentKind) ? (value as AgentKind) : null;
}

export function normalizeProjectSessionRow(dto: BackendProjectSessionRowDto): ProjectSessionRow {
  return {
    id: dto.id,
    title: dto.title ?? "",
    kind: normalizeSessionKind(dto.kind),
    href: dto.href,
    updatedAt: dto.updatedAt ?? dto.updated_at ?? "",
    aggregateStatus: dto.aggregateStatus ?? dto.aggregate_status ?? null,
    agentKind: normalizeAgentKind(dto.agentKind ?? dto.agent_kind),
    issueIdentifier: dto.issueIdentifier ?? dto.issue_identifier ?? null,
    workspacePath: dto.workspacePath ?? dto.workspace_path ?? null,
    workspaceId: dto.workspaceId ?? dto.workspace_id ?? null,
    pinned: dto.pinned ?? false,
    archived: dto.archived ?? false,
  };
}

export function normalizeProjectSessionsPage(dto: BackendProjectSessionsPageDto): ProjectSessionsPage {
  const meta = dto.meta ?? {};

  return {
    sessions: (dto.data ?? []).map(normalizeProjectSessionRow),
    nextCursor: meta.nextCursor ?? meta.next_cursor ?? null,
    projectActivityAt: meta.projectActivityAt ?? meta.project_activity_at ?? null,
  };
}

function buildListParams(input: ListProjectSessionsInput): Record<string, string> {
  const params: Record<string, string> = {
    limit: String(input.limit ?? DEFAULT_LIMIT),
  };

  if (input.cursor && input.cursor.trim()) {
    params.cursor = input.cursor.trim();
  }

  if (input.includeArchived) {
    params.include_archived = "true";
  }

  return params;
}

export async function listProjectSessions(input: ListProjectSessionsInput): Promise<ProjectSessionsPage> {
  const slug = requireProjectSlug(input.projectSlug);
  const path = trackerPath(`/projects/${encodeURIComponent(slug)}/sessions`);
  const response = await http.get<BackendProjectSessionsPageDto>(path, { params: buildListParams(input) });
  return normalizeProjectSessionsPage(response.data);
}
