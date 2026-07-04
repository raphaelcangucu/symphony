import { ChevronDown, PenLine, Play } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { IssueAuthoringPanel } from "@/components/assistant/IssueAuthoringPanel";
import { IssueDocumentsDrawer } from "@/components/assistant/IssueDocumentsDrawer";
import { Button } from "@/components/ui/button";
import { AgentStatusBadge } from "@/components/issues/AgentStatusBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveDisplayStatus } from "@/lib/agentExecutionDisplay";
import { composerSeedFromHandoff, consumePreviewAssistantHandoff } from "@/lib/previewAssistantHandoff";
import { consumeReturnToAgentHandoff, type ReturnToAgentTemplate } from "@/lib/returnToAgent";
import { assessEvidenceAttention } from "@/lib/evidenceStatus";
import {
  agentSectionFromSearchParams,
  type AgentSection,
  isAgentSection,
  withAgentSection,
  type WorkspaceView,
} from "@/lib/workspaceRoutes";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

import { AgentTab } from "./AgentTab";

const AgentAuthoringPanel = memo(function AgentAuthoringPanel({
  projectSlug,
  identifier,
  view,
}: {
  projectSlug: string;
  identifier: string;
  view: WorkspaceView;
}) {
  return (
    <IssueAuthoringPanel
      projectSlug={projectSlug}
      identifier={identifier}
      view={view}
      compact
    />
  );
});

interface AgentTabsProps {
  issue: Issue;
  projectSlug: string;
  execution?: AgentExecution;
  executions?: AgentExecution[];
  view: WorkspaceView;
  workflowMarkdown?: string | null;
  evidenceRecords?: import("@/types/evidence").EvidenceRecord[];
  onIssueUpdated?: (updated: Issue) => void;
}

export function AgentTabs({
  issue,
  projectSlug,
  execution,
  executions,
  view,
  workflowMarkdown = null,
  evidenceRecords = [],
  onIssueUpdated,
}: AgentTabsProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const section = agentSectionFromSearchParams(new URLSearchParams(location.search));
  const [steerSeedMessage, setSteerSeedMessage] = useState<string | null>(null);
  const [returnToAgentTemplate, setReturnToAgentTemplate] = useState<ReturnToAgentTemplate | null>(null);
  const [showExecutionStatus, setShowExecutionStatus] = useState(false);
  const executionDisplayStatus = execution ? resolveDisplayStatus(execution) : null;

  const setSection = useCallback(
    (nextSection: AgentSection) => {
      navigate(withAgentSection(location.pathname, location.search, nextSection), { replace: true });
    },
    [location.pathname, location.search, navigate],
  );

  useEffect(() => {
    const handoff = consumePreviewAssistantHandoff(projectSlug, issue.identifier);
    if (handoff?.target === "execution-steer") {
      setSteerSeedMessage(composerSeedFromHandoff(handoff));
      setSection("execution");
      return;
    }

    const returnHandoff = consumeReturnToAgentHandoff(projectSlug, issue.identifier);
    if (!returnHandoff) return;

    setReturnToAgentTemplate(returnHandoff.template);
    setSection("execution");
  }, [issue.identifier, projectSlug, setSection]);

  return (
    <Tabs
      value={section}
      onValueChange={(value) => {
        if (isAgentSection(value)) setSection(value);
      }}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
    >
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div
          data-testid="agent-tabs-left-control"
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
        >
          {section === "authoring" ? (
            <p className="text-xs text-muted-foreground">{t("issue.agentTabs.authoringHint")}</p>
          ) : null}
          {section === "execution" ? (
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
              <ChevronDown
                className={`h-3 w-3 transition-transform ${showExecutionStatus ? "rotate-180" : ""}`}
              />
            </Button>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <IssueDocumentsDrawer projectSlug={projectSlug} identifier={issue.identifier} />
          <TabsList
            aria-label={t("issue.agentTabs.sectionsAria")}
            className="h-8 shrink-0 gap-0.5 rounded-lg border border-border/60 bg-muted/60 p-0.5"
          >
            <TabsTrigger
              value="authoring"
              className="gap-1.5 rounded-md px-2.5 text-xs data-[state=active]:shadow-sm"
            >
              <PenLine className="h-3.5 w-3.5" />
              {t("issue.agentTabs.authoring")}
            </TabsTrigger>
            <TabsTrigger
              value="execution"
              className="gap-1.5 rounded-md px-2.5 text-xs data-[state=active]:shadow-sm"
            >
              <Play className="h-3.5 w-3.5" />
              {t("issue.agentTabs.execution")}
            </TabsTrigger>
          </TabsList>
        </div>
      </div>

      <TabsContent value="authoring" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
        <AgentAuthoringPanel
          projectSlug={projectSlug}
          identifier={issue.identifier}
          view={view}
        />
      </TabsContent>
      <TabsContent value="execution" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
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
      </TabsContent>
    </Tabs>
  );
}
