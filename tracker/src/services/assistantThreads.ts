import { requirePositiveInteger } from "@/lib/serviceValidation";
import type { AssistantThread } from "@/types/assistant-thread";

import { http, trackerPath, unwrapData } from "./http";

export interface BackendAssistantThreadDto {
  id: number;
  scope: string;
  project_slug?: string | null;
  projectSlug?: string | null;
  project_name?: string | null;
  projectName?: string | null;
  agent_kind?: string | null;
  agentKind?: string | null;
  issue_identifier?: string | null;
  issueIdentifier?: string | null;
  title?: string | null;
  status: string;
  preview?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
}

export function normalizeAssistantThread(dto: BackendAssistantThreadDto): AssistantThread {
  return {
    id: dto.id,
    scope: dto.scope,
    agentKind: normalizeAgentKind(dto.agentKind ?? dto.agent_kind),
    projectSlug: dto.projectSlug ?? dto.project_slug ?? null,
    projectName: dto.projectName ?? dto.project_name ?? null,
    issueIdentifier: dto.issueIdentifier ?? dto.issue_identifier ?? null,
    title: dto.title ?? null,
    status: dto.status,
    preview: dto.preview ?? null,
    updatedAt: dto.updatedAt ?? dto.updated_at ?? "",
  };
}

function normalizeAgentKind(value: string | null | undefined): AssistantThread["agentKind"] {
  return value === "codex" || value === "claude" || value === "cursor" ? value : null;
}

export async function listAssistantThreads(
  scopeOrOptions: string | ListAssistantThreadsOptions = "freeform",
): Promise<AssistantThread[]> {
  const params = new URLSearchParams();
  if (typeof scopeOrOptions === "string") {
    params.set("scope", scopeOrOptions);
  } else {
    if (scopeOrOptions.scope) params.set("scope", scopeOrOptions.scope);
    if (scopeOrOptions.scopes?.length) params.set("scopes", scopeOrOptions.scopes.join(","));
    if (scopeOrOptions.projectSlug) params.set("project_slug", scopeOrOptions.projectSlug);
    if (scopeOrOptions.issueIdentifier) params.set("issue_identifier", scopeOrOptions.issueIdentifier);
    if (scopeOrOptions.limit != null) params.set("limit", String(scopeOrOptions.limit));
  }

  const response = await http.get(trackerPath(`/assistant/threads?${params.toString()}`));
  return unwrapData<BackendAssistantThreadDto[]>(response).map(normalizeAssistantThread);
}

export interface ListAssistantThreadsOptions {
  scope?: string;
  scopes?: string[];
  projectSlug?: string;
  issueIdentifier?: string;
  limit?: number;
}

export async function createFreeformThread(title?: string): Promise<AssistantThread> {
  const response = await http.post(trackerPath("/assistant/threads"), { scope: "freeform", title });
  return normalizeAssistantThread(unwrapData<BackendAssistantThreadDto>(response));
}

export async function createProjectSessionThread(
  projectSlug: string,
  input: { title?: string; agentKind?: "codex" | "claude" | "cursor" | null } = {},
): Promise<AssistantThread> {
  const response = await http.post(trackerPath("/assistant/threads"), {
    scope: "project_session",
    project_slug: projectSlug,
    title: input.title,
    agent_kind: input.agentKind ?? undefined,
  });
  return normalizeAssistantThread(unwrapData<BackendAssistantThreadDto>(response));
}

export async function createIssueSessionThread(
  projectSlug: string,
  issueIdentifier: string,
  input: {
    title?: string;
    agentKind?: "codex" | "claude" | "cursor" | null;
    executionMode?: "plan" | "build" | "yolo";
  } = {},
): Promise<AssistantThread> {
  const response = await http.post(trackerPath("/assistant/threads"), {
    scope: "issue_session",
    project_slug: projectSlug,
    issue_identifier: issueIdentifier,
    title: input.title,
    agent_kind: input.agentKind ?? undefined,
    execution_mode: input.executionMode ?? "build",
  });
  return normalizeAssistantThread(unwrapData<BackendAssistantThreadDto>(response));
}

export async function archiveAssistantThread(threadId: number): Promise<AssistantThread> {
  requirePositiveInteger(threadId, "threadId");

  const response = await http.post(
    trackerPath(`/assistant/threads/${encodeURIComponent(String(threadId))}/archive`),
  );
  return normalizeAssistantThread(unwrapData<BackendAssistantThreadDto>(response));
}
