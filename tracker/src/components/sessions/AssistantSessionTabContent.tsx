import { GitBranch, GitCompare } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AssistantTasksToolbarToggle, type AssistantTasksDockControl } from "@/components/agent-activity";
import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import { IssueSessionSplitLayout } from "@/components/sessions/IssueSessionSplitLayout";
import {
  sessionToolbarChipClassName,
  sessionToolbarIconButtonClassName,
} from "@/components/sessions/sessionToolbarStyles";
import { WorkspaceDiffStatsChip } from "@/components/sessions/WorkspaceDiffStatsChip";
import { useAssistantThreadMetadata } from "@/hooks/useAssistantThreadMetadata";
import { useWorkspaceDiffStats } from "@/hooks/useWorkspaceDiffStats";
import { cn } from "@/lib/utils";
import type { WorkspaceView } from "@/lib/workspaceRoutes";
import type { RecentSession } from "@/types/recents";

interface AssistantSessionTabContentProps {
  projectSlug: string;
  threadId: number;
  view: WorkspaceView;
  relatedSessions?: readonly RecentSession[];
}

export function AssistantSessionTabContent({
  projectSlug,
  threadId,
  view,
  relatedSessions = [],
}: AssistantSessionTabContentProps) {
  const { t } = useTranslation();
  const thread = useAssistantThreadMetadata(projectSlug, threadId, relatedSessions);
  const issueIdentifier = thread?.issueIdentifier?.trim() || null;
  // Bumping this counter opens the diff modal owned by the assistant panel's
  // launcher, so the toolbar button and the composer button share one modal
  // (same thread-scoped diff, same review-to-agent wiring).
  const [diffRequestId, setDiffRequestId] = useState(0);
  const [tasksControl, setTasksControl] = useState<AssistantTasksDockControl | null>(null);
  const [kbControl, setKbControl] = useState<{ open: () => void; changedDocCount: number } | null>(null);
  const workspaceDiffStats = useWorkspaceDiffStats({
    projectSlug,
    issueIdentifier,
    threadId,
  });

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-background px-3 pb-2 pt-2 shadow-sm">
      {issueIdentifier ? (
        <IssueSessionSplitLayout
          projectSlug={projectSlug}
          issueIdentifier={issueIdentifier}
          view={view}
          onOpenKnowledgeBase={kbControl?.open}
          changedDocCount={kbControl?.changedDocCount ?? 0}
          headerStart={
            <span
              className={cn(sessionToolbarChipClassName, "font-mono")}
              title={t("sessions.issueThreadHint", { identifier: issueIdentifier })}
            >
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="truncate">{issueIdentifier}</span>
            </span>
          }
          toolbarLeading={
            <div className="inline-flex items-center gap-1">
              <AssistantTasksToolbarToggle control={tasksControl} />
              <button
                type="button"
                aria-label={t("issue.diff.button")}
                title={t("issue.diff.shortcutHint")}
                onClick={() => setDiffRequestId((current) => current + 1)}
                className={sessionToolbarIconButtonClassName}
              >
                <GitCompare className="h-4 w-4" />
              </button>
              <WorkspaceDiffStatsChip stats={workspaceDiffStats} />
            </div>
          }
        >
          <ProjectAssistantPanel
            projectSlug={projectSlug}
            threadId={threadId}
            issueIdentifier={issueIdentifier}
            view={view}
            mode="page"
            hideHeader
            diffRequestId={diffRequestId}
            contentMaxWidth="wide"
            onTasksDockControlChange={setTasksControl}
            onKnowledgeBaseControlChange={setKbControl}
          />
        </IssueSessionSplitLayout>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ProjectAssistantPanel
            projectSlug={projectSlug}
            threadId={threadId}
            view={view}
            mode="page"
            hideHeader
            diffRequestId={diffRequestId}
            contentMaxWidth="wide"
            onTasksDockControlChange={setTasksControl}
          />
        </div>
      )}
    </section>
  );
}
