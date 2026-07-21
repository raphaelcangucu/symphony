import { GitBranch, GitCompare } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import { ExecutionStatusHeaderControl } from "@/components/sessions/ExecutionStatusHeaderControl";
import { IssueSessionSplitLayout } from "@/components/sessions/IssueSessionSplitLayout";
import { SessionExecutionStatusProvider } from "@/components/sessions/sessionExecutionStatusContext";
import {
  sessionToolbarChipClassName,
  sessionToolbarIconButtonClassName,
} from "@/components/sessions/sessionToolbarStyles";
import { WorkspaceDiffStatsChip } from "@/components/sessions/WorkspaceDiffStatsChip";
import { useAssistantThreadMetadata } from "@/hooks/useAssistantThreadMetadata";
import { useWorkspaceDiffStats } from "@/hooks/useWorkspaceDiffStats";
import { consumePendingThreadSeed } from "@/lib/pendingThreadSeed";
import { cn } from "@/lib/utils";
import {
  issueWorkspaceScope,
  threadWorkspaceScope,
  workspaceScopeProvisioned,
  type WorkspaceScope,
} from "@/lib/workspaceScope";
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
  const [composerSeedMessage, setComposerSeedMessage] = useState<string | null>(null);
  const thread = useAssistantThreadMetadata(projectSlug, threadId, relatedSessions);

  useEffect(() => {
    const seed = consumePendingThreadSeed(threadId);
    if (seed) setComposerSeedMessage(seed);
  }, [threadId]);
  const issueIdentifier = thread?.issueIdentifier?.trim() || null;
  const scope: WorkspaceScope | null = issueIdentifier
    ? issueWorkspaceScope(projectSlug, issueIdentifier, threadId)
    : thread
      ? threadWorkspaceScope(projectSlug, threadId, thread.workspacePath ?? null)
      : null;
  const executionMode = thread?.scope === "issue_execution";
  // Bumping this counter opens the diff modal owned by the assistant panel's
  // launcher, so the toolbar button and the composer button share one modal
  // (same thread-scoped diff, same review-to-agent wiring).
  const [diffRequestId, setDiffRequestId] = useState(0);
  const [kbControl, setKbControl] = useState<{ open: () => void; changedDocCount: number } | null>(null);
  const workspaceDiffStats = useWorkspaceDiffStats({
    projectSlug,
    issueIdentifier,
    threadId,
  });
  const workspaceLabel =
    scope?.kind === "issue"
      ? scope.issueIdentifier
      : thread?.workspacePath?.split("/").filter(Boolean).at(-1) ||
        thread?.title?.trim() ||
        `thread-${threadId}`;

  return (
    <SessionExecutionStatusProvider>
      <section
        className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
        data-testid="assistant-session-tab"
      >
        {scope ? (
          <IssueSessionSplitLayout
            scope={scope}
            view={view}
            showOpenIssue={scope.kind === "issue"}
            pathActionsEnabled={workspaceScopeProvisioned(scope)}
            onOpenKnowledgeBase={kbControl?.open}
            changedDocCount={kbControl?.changedDocCount ?? 0}
            headerStart={
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(sessionToolbarChipClassName, "font-mono")}
                  title={
                    scope.kind === "issue"
                      ? t("sessions.issueThreadHint", { identifier: scope.issueIdentifier })
                      : thread?.workspacePath || workspaceLabel
                  }
                >
                  <GitBranch className="h-3 w-3 shrink-0" />
                  <span className="truncate">{workspaceLabel}</span>
                </span>
                <ExecutionStatusHeaderControl />
              </div>
            }
            toolbarLeading={
              <div className="inline-flex items-center gap-1">
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
              issueIdentifier={issueIdentifier ?? undefined}
              view={view}
              mode="page"
              hideHeader
              diffRequestId={diffRequestId}
              contentMaxWidth="default"
              composerSeedMessage={composerSeedMessage}
              executionMode={executionMode}
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
              contentMaxWidth="default"
              composerSeedMessage={composerSeedMessage}
              executionMode={executionMode}
            />
          </div>
        )}
      </section>
    </SessionExecutionStatusProvider>
  );
}
