import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type { ActivityEvent } from "@/types/activity";

import { http, trackerPath, unwrapData } from "./http";

interface BackendActivityEventDto {
  id: string | number;
  event_type?: string | null;
  metadata?: Record<string, unknown> | null;
  inserted_at?: string | null;
}

function normalizeActivityEvent(dto: BackendActivityEventDto): ActivityEvent {
  return {
    id: String(dto.id),
    eventType: dto.event_type ?? "unknown",
    metadata: dto.metadata ?? {},
    insertedAt: dto.inserted_at ?? "",
  };
}

export async function listActivityEvents(projectSlug: string, identifier: string): Promise<ActivityEvent[]> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");

  const response = await http.get(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/activity`),
  );

  return unwrapData<BackendActivityEventDto[]>(response).map(normalizeActivityEvent);
}
