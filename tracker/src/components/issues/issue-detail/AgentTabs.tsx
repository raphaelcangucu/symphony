import { PenLine, Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { IssueAuthoringPanel } from "@/components/assistant/IssueAuthoringPanel";
import { IssueDocumentsDrawer } from "@/components/assistant/IssueDocumentsDrawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
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

interface AgentTabsProps {
  issue: Issue;
  projectSlug: string;
  execution?: AgentExecution;
  view: WorkspaceView;
  workflowMarkdown?: string | null;
  evidenceRecords?: import("@/types/evidence").EvidenceRecord[];
  onIssueUpdated?: (updated: Issue) => void;
}

export function AgentTabs({
  issue,
  projectSlug,
  execution,
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
  const [documentsRefreshKey, setDocumentsRefreshKey] = useState(0);

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
        <p className="text-xs text-muted-foreground">
          {section === "authoring" ? t("issue.agentTabs.authoringHint") : t("issue.agentTabs.executionHint")}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <IssueDocumentsDrawer
            projectSlug={projectSlug}
            identifier={issue.identifier}
            refreshKey={documentsRefreshKey}
          />
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
        <IssueAuthoringPanel
          projectSlug={projectSlug}
          identifier={issue.identifier}
          view={view}
          compact
          onDocumentsChanged={() => setDocumentsRefreshKey((current) => current + 1)}
        />
      </TabsContent>
      <TabsContent
        value="execution"
        className={cn("mt-0 min-h-0 flex-1 overflow-y-auto pb-1", SCROLLBAR_THIN)}
      >
        <AgentTab
          issue={issue}
          execution={execution}
          projectSlug={projectSlug}
          workflowMarkdown={workflowMarkdown}
          evidenceAttention={assessEvidenceAttention(evidenceRecords)}
          returnToAgentTemplate={returnToAgentTemplate}
          steerSeedMessage={steerSeedMessage}
          onIssueUpdated={onIssueUpdated}
        />
      </TabsContent>
    </Tabs>
  );
}
