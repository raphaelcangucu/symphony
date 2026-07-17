import { ExternalLink, PenLine, Play, PlayCircle, TerminalSquare } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { ExecutionSessionPanel } from "@/components/assistant/ExecutionSessionPanel";
import { IssueAuthoringPanel } from "@/components/assistant/IssueAuthoringPanel";
import { IssueDocumentsDrawer } from "@/components/assistant/IssueDocumentsDrawer";
import { IssueEditorMenu } from "@/components/issues/IssueEditorMenu";
import { StartIssueSessionDialog } from "@/components/sessions/StartIssueSessionDialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { composerSeedFromHandoff, consumePreviewAssistantHandoff } from "@/lib/previewAssistantHandoff";
import { consumeReturnToAgentHandoff } from "@/lib/returnToAgent";
import { resolveExecutionSessionId } from "@/lib/resolveExecutionSessionId";
import {
  agentSectionFromSearchParams,
  type AgentSection,
  isAgentSection,
  withAgentSection,
  type WorkspaceView,
} from "@/lib/workspaceRoutes";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

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
  /**
   * When set, the header exposes issue-scoped shortcuts (open the full issue
   * page, a terminal, and the "Code" editor menu). Provided only when these tabs
   * render standalone (e.g. a session tab), since the issue drawer already
   * offers them.
   */
  issueHref?: string | null;
  issueTerminalHref?: string | null;
  onIssueUpdated?: (updated: Issue) => void;
}

export function AgentTabs({
  issue,
  projectSlug,
  execution,
  executions,
  view,
  issueHref = null,
  issueTerminalHref = null,
}: AgentTabsProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const section = agentSectionFromSearchParams(new URLSearchParams(location.search));
  const [steerSeedMessage, setSteerSeedMessage] = useState<string | null>(null);
  const [startSessionOpen, setStartSessionOpen] = useState(false);

  const executionThreadId = useMemo(() => {
    if (execution?.executionSessionId != null && execution.executionSessionId > 0) {
      return execution.executionSessionId;
    }
    if (executions?.length) {
      return resolveExecutionSessionId(executions, issue.identifier);
    }
    return null;
  }, [execution, executions, issue.identifier]);

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

    setSection("execution");
  }, [issue.identifier, projectSlug, setSection]);

  return (
    <>
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
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
          {issueHref ? (
            <>
              <Link
                to={issueHref}
                aria-label={t("sessions.openIssueAria", { identifier: issue.identifier })}
                title={t("sessions.openIssueAria", { identifier: issue.identifier })}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <ExternalLink className="h-4 w-4" />
              </Link>
              {issueTerminalHref ? (
                <Link
                  to={issueTerminalHref}
                  aria-label={t("issue.terminal.ariaLabel", { identifier: issue.identifier })}
                  title={t("issue.terminal.ariaLabel", { identifier: issue.identifier })}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <TerminalSquare className="h-4 w-4" />
                </Link>
              ) : null}
              <IssueEditorMenu projectSlug={projectSlug} identifier={issue.identifier} />
            </>
          ) : null}
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
        {executionThreadId != null ? (
          <ExecutionSessionPanel
            projectSlug={projectSlug}
            threadId={executionThreadId}
            issueIdentifier={issue.identifier}
            composerSeedMessage={steerSeedMessage}
          />
        ) : (
          <div
            data-testid="agent-execution-empty"
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-background/70 px-5 py-10 text-center"
          >
            <p className="text-sm text-muted-foreground">{t("issue.sessions.empty")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setStartSessionOpen(true)}
              title={t("issue.agentTabs.newSessionTitle")}
            >
              <PlayCircle className="h-3.5 w-3.5" />
              {t("issue.agentTabs.newSession")}
            </Button>
          </div>
        )}
      </TabsContent>
    </Tabs>
    <StartIssueSessionDialog
      projectSlug={projectSlug}
      issue={{
        identifier: issue.identifier,
        title: issue.title,
        agentKind: issue.agentKind ?? null,
        parentIdentifier: issue.parentIdentifier ?? null,
      }}
      open={startSessionOpen}
      onOpenChange={setStartSessionOpen}
      view={view}
      onCreated={() => setSection("execution")}
    />
    </>
  );
}
