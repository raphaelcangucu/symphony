import type { ActivityEvent } from "@/types/activity";

import { http, trackerPath, unwrapData } from "./http";

interface BackendActivityEventDto {
  id: string | number;
  event_type?: string | null;
  eventType?: string | null;
  metadata?: Record<string, unknown> | null;
  inserted_at?: string | null;
  insertedAt?: string | null;
}

function normalizeActivityEvent(dto: BackendActivityEventDto): ActivityEvent {
  return {
    id: String(dto.id),
    eventType: dto.event_type ?? dto.eventType ?? "unknown",
    metadata: dto.metadata ?? {},
    insertedAt: dto.inserted_at ?? dto.insertedAt ?? "",
  };
}

export async function listActivityEvents(projectSlug: string, identifier: string): Promise<ActivityEvent[]> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");

  const response = await http.get(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/activity`),
  );

  return unwrapData<BackendActivityEventDto[]>(response).map(normalizeActivityEvent);
}
