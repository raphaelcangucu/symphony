import { useTranslation } from "react-i18next";

import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import { IssueWorkingTreeToolbar } from "@/components/sessions/IssueWorkingTreeToolbar";
import { useAssistantThreadMetadata } from "@/hooks/useAssistantThreadMetadata";
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

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl border border-border/60 bg-background p-3 shadow-sm">
      {issueIdentifier ? (
        <div className="flex shrink-0 items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {t("sessions.issueThreadHint", { identifier: issueIdentifier })}
          </p>
          <IssueWorkingTreeToolbar projectSlug={projectSlug} issueIdentifier={issueIdentifier} view={view} />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        <ProjectAssistantPanel
          projectSlug={projectSlug}
          threadId={threadId}
          issueIdentifier={issueIdentifier ?? undefined}
          view={view}
          mode="page"
          contentMaxWidth="wide"
        />
      </div>
    </section>
  );
}
