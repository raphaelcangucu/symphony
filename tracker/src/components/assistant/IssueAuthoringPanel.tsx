import { useCallback, useMemo, useState } from "react";

import { DocumentViewer } from "@/components/assistant/DocumentViewer";
import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import { useIssueDocuments } from "@/hooks/useIssueDocuments";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
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
  const normalizedIdentifier = useMemo(() => normalizeIssueIdentifier(identifier) || null, [identifier]);
  const [refreshKey, setRefreshKey] = useState(0);
  const issueDocuments = useIssueDocuments({
    projectSlug,
    identifier: normalizedIdentifier,
    enabled: normalizedIdentifier !== null,
    refreshKey,
  });

  const handleDocumentChanged = useCallback(
    (payload: AssistantDocumentChangedPayload) => {
      if (!normalizedIdentifier) return;
      if (normalizeIssueIdentifier(payload.identifier) !== normalizedIdentifier) return;

      setRefreshKey((current) => current + 1);
    },
    [normalizedIdentifier],
  );

  const assistantPanel = (
    <div className="min-h-0 overflow-hidden rounded-xl border bg-background shadow-sm">
      <ProjectAssistantPanel
        projectSlug={projectSlug}
        threadId={threadId}
        issueIdentifier={normalizedIdentifier ?? undefined}
        view={view}
        mode={compact ? "embedded" : "page"}
        onDocumentChanged={handleDocumentChanged}
      />
    </div>
  );

  const documentsPanel = (
    <>
      <div className="shrink-0 rounded-xl border bg-card px-4 py-3 shadow-sm">
        <h1 className="text-sm font-semibold">
          {normalizedIdentifier ? `Issue authoring: ${normalizedIdentifier}` : "New issue authoring"}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Documents refresh when the assistant reports changes for the open issue. Simple/complex mode controls can be
          added once the assistant channel exposes a mode API.
        </p>
      </div>

      {normalizedIdentifier ? (
        <DocumentViewer
          projectSlug={projectSlug}
          identifier={normalizedIdentifier}
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
    </>
  );

  if (compact) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden bg-muted/20 p-3">
        <section className="min-h-0 flex-[1.15] overflow-hidden" aria-label="Issue authoring chat">
          {assistantPanel}
        </section>

        <aside className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden" aria-label="Issue authoring documents">
          {documentsPanel}
        </aside>
      </div>
    );
  }

  return (
    <main
      className={cn(
        "grid min-h-[calc(100vh-4rem)] gap-4 bg-muted/20 p-4",
        "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(26rem,0.85fr)]",
      )}
    >
      {assistantPanel}

      <aside className="flex min-h-0 flex-col gap-3" aria-label="Issue authoring documents">
        {documentsPanel}
      </aside>
    </main>
  );
}
