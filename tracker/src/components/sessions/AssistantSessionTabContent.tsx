import { GitBranch } from "lucide-react";
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
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-background px-3 pb-2 pt-2 shadow-sm">
      {issueIdentifier ? (
        <IssueSessionSplitLayout
          projectSlug={projectSlug}
          issueIdentifier={issueIdentifier}
          view={view}
          headerStart={
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground"
              title={t("sessions.issueThreadHint", { identifier: issueIdentifier })}
            >
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="truncate">{issueIdentifier}</span>
            </span>
          }
        >
          <ProjectAssistantPanel
            projectSlug={projectSlug}
            threadId={threadId}
            issueIdentifier={issueIdentifier}
            view={view}
            mode="page"
            hideHeader
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
            hideHeader
            contentMaxWidth="wide"
          />
        </div>
      )}
    </section>
  );
}
