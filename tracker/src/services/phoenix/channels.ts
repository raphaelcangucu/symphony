import type { Channel } from "phoenix";

import { requireProjectSlug } from "@/lib/serviceValidation";

import { normalizeProjectRealtimePayload } from "@/services/mappers";
import type { ProjectRealtimeEventName, ProjectRealtimePayloadByEvent } from "@/types/realtime-events";

export const PROJECT_REALTIME_EVENTS = [
  "issue_created",
  "issue_updated",
  "issue_moved",
  "comment_created",
  "blocker_changed",
] as const satisfies readonly ProjectRealtimeEventName[];

export function projectTopic(projectSlug: string): string {
  const slug = requireProjectSlug(projectSlug);
  return `project:${slug}`;
}

export function isProjectRealtimeEventName(value: string): value is ProjectRealtimeEventName {
  return PROJECT_REALTIME_EVENTS.includes(value as ProjectRealtimeEventName);
}

export function bindProjectEvents(
  channel: Channel,
  onEvent: <TEvent extends ProjectRealtimeEventName>(
    event: TEvent,
    payload: ProjectRealtimePayloadByEvent[TEvent],
  ) => void,
): void {
  for (const event of PROJECT_REALTIME_EVENTS) {
    channel.on(event, (payload) => {
      onEvent(event, normalizeProjectRealtimePayload(event, payload as never));
    });
  }
}
