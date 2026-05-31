import type { AssistantThread } from "@/types/assistant-thread";

import { http, trackerPath, unwrapData } from "./http";

export interface BackendAssistantThreadDto {
  id: number;
  scope: string;
  project_slug?: string | null;
  projectSlug?: string | null;
  project_name?: string | null;
  projectName?: string | null;
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
    projectSlug: dto.projectSlug ?? dto.project_slug ?? null,
    projectName: dto.projectName ?? dto.project_name ?? null,
    issueIdentifier: dto.issueIdentifier ?? dto.issue_identifier ?? null,
    title: dto.title ?? null,
    status: dto.status,
    preview: dto.preview ?? null,
    updatedAt: dto.updatedAt ?? dto.updated_at ?? "",
  };
}

export async function listAssistantThreads(scope = "freeform"): Promise<AssistantThread[]> {
  const response = await http.get(trackerPath(`/assistant/threads?scope=${encodeURIComponent(scope)}`));
  return unwrapData<BackendAssistantThreadDto[]>(response).map(normalizeAssistantThread);
}

export async function createFreeformThread(title?: string): Promise<AssistantThread> {
  const response = await http.post(trackerPath("/assistant/threads"), { scope: "freeform", title });
  return normalizeAssistantThread(unwrapData<BackendAssistantThreadDto>(response));
}
