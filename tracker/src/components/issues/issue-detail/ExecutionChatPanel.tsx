import { useTranslation } from "react-i18next";

import { BundlePanel } from "@/components/issues/issue-detail/BundlePanel";
import { ExecutionControlComposer } from "@/components/issues/issue-detail/ExecutionControlComposer";
import { ExecutionStatusHeader } from "@/components/issues/issue-detail/ExecutionStatusHeader";
import { IssueSessionLog } from "@/components/issues/issue-detail/IssueSessionLog";
import { ReturnToAgentPanel } from "@/components/issues/issue-detail/ReturnToAgentPanel";
import { useSessionLogChannel } from "@/hooks/useSessionLogChannel";
import { canResumeExecution, canSteerExecution } from "@/lib/agentExecutionDisplay";
import { assessEvidenceAttention, type EvidenceAttention } from "@/lib/evidenceStatus";
import type { ReturnToAgentTemplate } from "@/lib/returnToAgent";
import { isWaitState, parseWorkflowTrackerConfig, type WorkflowTrackerConfig } from "@/lib/workflowTracker";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

interface ExecutionChatPanelProps {
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
 * Renders the Issue Detail execution experience as a live chat: a compact
 * status header, the streaming session log as the transcript, and the execution
 * composer pinned at the bottom. While a run is live the composer steers by
 * default; while it is stopped the same input resumes with instructions (see
 * `ExecutionControlComposer`).
 */
export function ExecutionChatPanel({
  issue,
  execution,
  executions,
  projectSlug,
  workflowMarkdown = null,
  evidenceAttention,
  returnToAgentTemplate = null,
  steerSeedMessage = null,
  onIssueUpdated,
}: ExecutionChatPanelProps) {
  const { t } = useTranslation();
  const trackerConfig: WorkflowTrackerConfig = parseWorkflowTrackerConfig(workflowMarkdown);
  const inWaitState = isWaitState(issue.status, trackerConfig);
  const showReturnPanel = inWaitState && canResumeExecution(execution);
  const resolvedEvidenceAttention = evidenceAttention ?? assessEvidenceAttention([]);
  const bundleExecutions = executions ?? (execution ? [execution] : []);

  const sessionLog = useSessionLogChannel({
    projectSlug,
    issueIdentifier: issue.identifier,
    enabled: true,
    agentKind: execution?.agentKind ?? issue.agentKind ?? null,
  });
  const canSteer = canSteerExecution(execution);

  const composer = (
    <ExecutionControlComposer
      projectSlug={projectSlug}
      issue={issue}
      execution={execution}
      sessionConnected={sessionLog.connected}
      canSteer={canSteer}
      steerPending={sessionLog.steerPending}
      steerError={sessionLog.steerError}
      seedMessage={steerSeedMessage}
      onSteer={sessionLog.steerTurn}
      onIssueUpdated={onIssueUpdated}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 text-sm">
      <div className="shrink-0 space-y-3">
        <BundlePanel issue={issue} executions={bundleExecutions} />
        <ExecutionStatusHeader
          projectSlug={projectSlug}
          issue={issue}
          execution={execution}
          onIssueUpdated={onIssueUpdated}
        />
        {showReturnPanel ? (
          <ReturnToAgentPanel
            projectSlug={projectSlug}
            issue={issue}
            trackerConfig={trackerConfig}
            evidenceAttention={resolvedEvidenceAttention}
            initialTemplate={returnToAgentTemplate}
            onIssueUpdated={onIssueUpdated}
          />
        ) : null}
      </div>

      <IssueSessionLog
        fill
        issueIdentifier={issue.identifier}
        connected={sessionLog.connected}
        entries={sessionLog.entries}
        error={sessionLog.error}
        logAgentKind={sessionLog.logAgentKind}
        preferredAgentKind={sessionLog.preferredAgentKind ?? execution?.agentKind ?? issue.agentKind}
      />

      <div className="shrink-0">
        {showReturnPanel ? (
          <details className="rounded-xl border border-border/70 bg-card/20 p-3">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              {t("issue.agent.advancedControls")}
            </summary>
            <div className="mt-3">{composer}</div>
          </details>
        ) : (
          composer
        )}
      </div>
    </div>
  );
}
