import { useCallback, useMemo, useState } from "react";

import { DocumentViewer } from "@/components/assistant/DocumentViewer";
import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import { useIssueDocuments } from "@/hooks/useIssueDocuments";
import type { WorkspaceView } from "@/lib/workspaceRoutes";
import { cn } from "@/lib/utils";
import type { AssistantDocumentChangedPayload } from "@/services/phoenix/assistantChannel";

interface IssueAuthoringPanelProps {
  projectSlug: string;
  threadId?: number;
  identifier?: string;
  view: WorkspaceView;
  compact?: boolean;
}

export function IssueAuthoringPanel({
  projectSlug,
  threadId,
  identifier,
  view,
  compact = false,
}: IssueAuthoringPanelProps) {
  const trimmedIdentifier = useMemo(() => identifier?.trim() || null, [identifier]);
  const [refreshKey, setRefreshKey] = useState(0);
  const issueDocuments = useIssueDocuments({
    projectSlug,
    identifier: trimmedIdentifier,
    enabled: trimmedIdentifier !== null,
    refreshKey,
  });

  const handleDocumentChanged = useCallback(
    (payload: AssistantDocumentChangedPayload) => {
      if (!trimmedIdentifier) return;
      if (payload.identifier !== trimmedIdentifier) return;

      setRefreshKey((current) => current + 1);
    },
    [trimmedIdentifier],
  );

  return (
    <main
      className={cn(
        "grid min-h-[calc(100vh-4rem)] gap-4 bg-muted/20 p-4",
        compact ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(26rem,0.85fr)]",
      )}
    >
      <div className="min-h-0 overflow-hidden rounded-xl border bg-background shadow-sm">
        <ProjectAssistantPanel
          projectSlug={projectSlug}
          threadId={threadId}
          view={view}
          mode="page"
          onDocumentChanged={handleDocumentChanged}
        />
      </div>

      <aside className="flex min-h-0 flex-col gap-3" aria-label="Issue authoring documents">
        <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
          <h1 className="text-sm font-semibold">
            {trimmedIdentifier ? `Issue authoring: ${trimmedIdentifier}` : "New issue authoring"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Documents refresh when the assistant reports changes for the open issue. Simple/complex mode controls can
            be added once the assistant channel exposes a mode API.
          </p>
        </div>

        {trimmedIdentifier ? (
          <DocumentViewer
            projectSlug={projectSlug}
            identifier={trimmedIdentifier}
            documents={issueDocuments.documents}
            available={issueDocuments.available}
            reason={issueDocuments.reason}
          />
        ) : (
          <div className="rounded-xl border bg-card px-6 py-8 text-center text-sm text-muted-foreground shadow-sm">
            Draft documents appear here after the assistant creates or links an issue. Start by asking the project
            assistant to draft the issue, then open the issue authoring route once an identifier exists.
          </div>
        )}
      </aside>
    </main>
  );
}
