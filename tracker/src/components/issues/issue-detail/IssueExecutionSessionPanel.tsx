import { ChevronDown, PlayCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { IssueWorkingTreeToolbar } from "@/components/sessions/IssueWorkingTreeToolbar";
import { StartIssueSessionDialog } from "@/components/sessions/StartIssueSessionDialog";
import { Button } from "@/components/ui/button";
import { AgentStatusBadge } from "@/components/issues/AgentStatusBadge";
import { resolveDisplayStatus } from "@/lib/agentExecutionDisplay";
import { composerSeedFromHandoff, consumePreviewAssistantHandoff } from "@/lib/previewAssistantHandoff";
import { consumeReturnToAgentHandoff, type ReturnToAgentTemplate } from "@/lib/returnToAgent";
import { assessEvidenceAttention } from "@/lib/evidenceStatus";
import type { WorkspaceView } from "@/lib/workspaceRoutes";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

import { AgentTab } from "./AgentTab";

interface IssueExecutionSessionPanelProps {
  issue: Issue;
  projectSlug: string;
  execution?: AgentExecution;
  executions?: AgentExecution[];
  view: WorkspaceView;
  workflowMarkdown?: string | null;
  evidenceRecords?: import("@/types/evidence").EvidenceRecord[];
  onIssueUpdated?: (updated: Issue) => void;
}

export function IssueExecutionSessionPanel({
  issue,
  projectSlug,
  execution,
  executions,
  view,
  workflowMarkdown = null,
  evidenceRecords = [],
  onIssueUpdated,
}: IssueExecutionSessionPanelProps) {
  const { t } = useTranslation();
  const [steerSeedMessage, setSteerSeedMessage] = useState<string | null>(null);
  const [returnToAgentTemplate, setReturnToAgentTemplate] = useState<ReturnToAgentTemplate | null>(null);
  const [showExecutionStatus, setShowExecutionStatus] = useState(false);
  const [startSessionOpen, setStartSessionOpen] = useState(false);
  const executionDisplayStatus = execution ? resolveDisplayStatus(execution) : null;

  const applyExecutionHandoffs = useCallback(() => {
    const handoff = consumePreviewAssistantHandoff(projectSlug, issue.identifier);
    if (handoff?.target === "execution-steer") {
      setSteerSeedMessage(composerSeedFromHandoff(handoff));
      return;
    }

    const returnHandoff = consumeReturnToAgentHandoff(projectSlug, issue.identifier);
    if (!returnHandoff) return;
    setReturnToAgentTemplate(returnHandoff.template);
  }, [issue.identifier, projectSlug]);

  useEffect(() => {
    applyExecutionHandoffs();
  }, [applyExecutionHandoffs]);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            aria-expanded={showExecutionStatus}
            onClick={() => setShowExecutionStatus((current) => !current)}
          >
            {t("issue.agent.tab.runStatus")}
            {executionDisplayStatus ? (
              <AgentStatusBadge status={executionDisplayStatus} showIcon={false} className="ml-0.5 px-1.5 py-0 text-[10px]" />
            ) : null}
            <ChevronDown className={`h-3 w-3 transition-transform ${showExecutionStatus ? "rotate-180" : ""}`} />
          </Button>
          <IssueWorkingTreeToolbar
            projectSlug={projectSlug}
            issueIdentifier={issue.identifier}
            view={view}
            trailing={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={() => setStartSessionOpen(true)}
                title={t("issue.agentTabs.newSessionTitle")}
              >
                <PlayCircle className="h-3.5 w-3.5" />
                {t("issue.agentTabs.newSession")}
              </Button>
            }
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <AgentTab
            issue={issue}
            execution={execution}
            executions={executions}
            projectSlug={projectSlug}
            workflowMarkdown={workflowMarkdown}
            evidenceAttention={assessEvidenceAttention(evidenceRecords)}
            returnToAgentTemplate={returnToAgentTemplate}
            steerSeedMessage={steerSeedMessage}
            showExecutionStatus={showExecutionStatus}
            onIssueUpdated={onIssueUpdated}
          />
        </div>
      </div>
      <StartIssueSessionDialog
        projectSlug={projectSlug}
        issue={{
          identifier: issue.identifier,
          title: issue.title,
          agentKind: issue.agentKind ?? null,
        }}
        open={startSessionOpen}
        onOpenChange={setStartSessionOpen}
        view={view}
        navigateToProjectSession
      />
    </>
  );
}
