import { AgentTaskList } from "@/components/agent-activity/AgentTaskList";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

interface AgentTaskPinnedPanelProps {
  snapshot: AgentTaskSnapshot | null | undefined;
}

export function AgentTaskPinnedPanel({ snapshot }: AgentTaskPinnedPanelProps) {
  if (!snapshot) return null;
  return <AgentTaskList snapshot={snapshot} />;
}
