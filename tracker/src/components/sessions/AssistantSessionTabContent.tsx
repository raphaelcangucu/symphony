import { useTranslation } from "react-i18next";

import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import { IssueSessionSplitLayout } from "@/components/sessions/IssueSessionSplitLayout";
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
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-background p-3 shadow-sm">
      {issueIdentifier ? (
        <IssueSessionSplitLayout
          projectSlug={projectSlug}
          issueIdentifier={issueIdentifier}
          view={view}
          headerStart={
            <p className="text-xs text-muted-foreground">
              {t("sessions.issueThreadHint", { identifier: issueIdentifier })}
            </p>
          }
        >
          <ProjectAssistantPanel
            projectSlug={projectSlug}
            threadId={threadId}
            issueIdentifier={issueIdentifier}
            view={view}
            mode="page"
            contentMaxWidth="wide"
          />
        </IssueSessionSplitLayout>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ProjectAssistantPanel
            projectSlug={projectSlug}
            threadId={threadId}
            view={view}
            mode="page"
            contentMaxWidth="wide"
          />
        </div>
      )}
    </section>
  );
}
