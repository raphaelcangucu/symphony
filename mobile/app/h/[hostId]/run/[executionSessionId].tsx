import { HostSessionRoute } from "@/features/sessions/SessionRoute";

export default function OrchestratorSessionPage() {
  // An orchestrator execution is a durable task-scoped assistant thread.  Keep
  // the legacy deep-link shape, but render it through the same chat surface as
  // every other session: history, grouped tool timeline, changes and composer
  // then all share one source of truth instead of rebuilding a second transcript
  // from provider JSONL.
  return <HostSessionRoute />;
}
