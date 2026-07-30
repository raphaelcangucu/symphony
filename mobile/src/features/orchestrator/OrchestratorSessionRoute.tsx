import { HostSessionRoute } from "@/features/sessions/SessionRoute";

/**
 * Compatibility entry point for old imports.
 *
 * An issue execution is a normal, task-scoped assistant thread. Keeping this
 * component as a thin alias prevents any stale navigation from falling back to
 * the old provider-event transcript and guarantees the same conversation,
 * grouped activity cards, task link, steer and queued-message controls as
 * `/h/:hostId/chat/:threadId`.
 */
export function OrchestratorSessionRoute() {
  return <HostSessionRoute />;
}
