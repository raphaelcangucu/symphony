import { ExecutionChatPanel } from "@/components/issues/issue-detail/ExecutionChatPanel";
import type { EvidenceAttention } from "@/lib/evidenceStatus";
import type { ReturnToAgentTemplate } from "@/lib/returnToAgent";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

interface AgentTabProps {
  issue: Issue;
  execution?: AgentExecution;
  executions?: AgentExecution[];
  projectSlug: string;
  workflowMarkdown?: string | null;
  evidenceAttention?: EvidenceAttention;
  returnToAgentTemplate?: ReturnToAgentTemplate | null;
  steerSeedMessage?: string | null;
  onIssueUpdated?: (updated: Issue) => void;
}

/**
 * Thin adapter kept as the stable seam that `AgentTabs` (and its tests) mount
 * for the Execution section. The chat experience lives in `ExecutionChatPanel`.
 */
export function AgentTab(props: AgentTabProps) {
  return <ExecutionChatPanel {...props} />;
}
