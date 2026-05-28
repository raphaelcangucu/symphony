import { useEffect, useRef } from "react";

import { bindProjectEvents, projectTopic } from "@/services/phoenix/channels";
import { createTrackerSocket } from "@/services/phoenix/socket";
import type { ProjectRealtimeEventName, ProjectRealtimePayloadByEvent } from "@/types/realtime-events";

export type ProjectChannelHandler = <TEvent extends ProjectRealtimeEventName>(
  event: TEvent,
  payload: ProjectRealtimePayloadByEvent[TEvent],
) => void;

export function useProjectChannel(projectSlug: string | null | undefined, onEvent: ProjectChannelHandler): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const slug = projectSlug?.trim();
    if (!slug) return undefined;

    const socket = createTrackerSocket();
    socket.connect();

    const channel = socket.channel(projectTopic(slug));
    bindProjectEvents(channel, (event, payload) => onEventRef.current(event, payload));

    channel
      .join()
      .receive("error", (reason) => {
        console.error("Failed to join tracker project channel", { projectSlug: slug, reason });
      })
      .receive("timeout", () => {
        console.error("Timed out joining tracker project channel", { projectSlug: slug });
      });

    return () => {
      channel.leave();
      socket.disconnect();
    };
  }, [projectSlug]);
}
