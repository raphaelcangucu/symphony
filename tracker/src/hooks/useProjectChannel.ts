import { useRef } from "react";

import { usePhoenixChannel } from "@/hooks/usePhoenixChannel";
import { bindProjectEvents, projectTopic } from "@/services/phoenix/channels";
import type { ProjectRealtimeEventName, ProjectRealtimePayloadByEvent } from "@/types/realtime-events";

export type ProjectChannelHandler = <TEvent extends ProjectRealtimeEventName>(
  event: TEvent,
  payload: ProjectRealtimePayloadByEvent[TEvent],
) => void;

export function useProjectChannel(projectSlug: string | null | undefined, onEvent: ProjectChannelHandler): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const slug = projectSlug?.trim();

  usePhoenixChannel({
    topic: slug ? projectTopic(slug) : null,
    onSetup: (channel) => bindProjectEvents(channel, (event, payload) => onEventRef.current(event, payload)),
    onJoinError: (reason) => {
      console.error("Failed to join tracker project channel", { projectSlug: slug, reason });
    },
    onJoinTimeout: () => {
      console.error("Timed out joining tracker project channel", { projectSlug: slug });
    },
  });
}
