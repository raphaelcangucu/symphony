import { useCallback, useMemo, useState } from "react";

import { DocumentViewer } from "@/components/assistant/DocumentViewer";
import {
  ProjectAssistantPanel,
  type DraftIssueCreated,
  type IssueAssistantMode,
} from "@/components/assistant/ProjectAssistantPanel";
import { Button } from "@/components/ui/button";
import { useIssueDocuments } from "@/hooks/useIssueDocuments";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import type { WorkspaceView } from "@/lib/workspaceRoutes";
import { cn } from "@/lib/utils";
import type { AssistantDocumentChangedPayload, AssistantIssueCreatedPayload } from "@/services/phoenix/assistantChannel";

interface IssueAuthoringPanelProps {
  projectSlug: string;
  threadId?: number;
  identifier?: string;
  view: WorkspaceView;
  compact?: boolean;
  onDraftIssueCreated?: (issue: DraftIssueCreated) => void;
  onIssueCreated?: (issue: AssistantIssueCreatedPayload) => void;
}

export function IssueAuthoringPanel({
  projectSlug,
  threadId,
  identifier,
  view,
  compact = false,
  onDraftIssueCreated,
  onIssueCreated,
}: IssueAuthoringPanelProps) {
  const normalizedIdentifier = useMemo(() => normalizeIssueIdentifier(identifier) || null, [identifier]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [issueMode, setIssueMode] = useState<IssueAssistantMode>("triage");
  const [issueModeRequestId, setIssueModeRequestId] = useState(0);
  const [issueModeStatus, setIssueModeStatus] = useState<string | null>(null);
  const [issueModeError, setIssueModeError] = useState<string | null>(null);
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

  const selectIssueMode = useCallback((mode: Exclude<IssueAssistantMode, "triage">) => {
    setIssueMode(mode);
    setIssueModeRequestId((current) => current + 1);
    setIssueModeError(null);
    setIssueModeStatus(`Setting ${issueModeLabel(mode)} mode...`);
  }, []);

  const handleIssueModeChanged = useCallback((mode: IssueAssistantMode) => {
    setIssueMode(mode);
    setIssueModeError(null);
    setIssueModeStatus(`${issueModeLabel(mode)} mode active.`);
  }, []);

  const handleIssueModeError = useCallback((message: string) => {
    setIssueModeError(message);
    setIssueModeStatus(null);
  }, []);

  const assistantPanel = (
    <div
      className={cn(
        "min-h-0 overflow-hidden rounded-xl border bg-background shadow-sm",
        compact && "h-full flex-1",
      )}
    >
      <ProjectAssistantPanel
        projectSlug={projectSlug}
        threadId={threadId}
        issueIdentifier={normalizedIdentifier ?? undefined}
        view={view}
        mode={compact ? "embedded" : "page"}
        issueMode={normalizedIdentifier ? issueMode : undefined}
        issueModeRequestId={issueModeRequestId}
        onDocumentChanged={handleDocumentChanged}
        onDraftIssueCreated={onDraftIssueCreated}
        onIssueCreated={onIssueCreated}
        onIssueModeChanged={handleIssueModeChanged}
        onIssueModeError={handleIssueModeError}
      />
    </div>
  );

  const documentsContent = normalizedIdentifier ? (
    <DocumentViewer
      projectSlug={projectSlug}
      identifier={normalizedIdentifier}
      documents={issueDocuments.documents}
      available={issueDocuments.available}
      reason={issueDocuments.reason}
    />
  ) : (
    <div className="rounded-xl border bg-card px-6 py-8 text-center text-sm text-muted-foreground shadow-sm">
      Draft documents appear here after the assistant creates or links an issue. Start by asking the project assistant
      to draft the issue, then open the issue authoring route once an identifier exists.
    </div>
  );

  const documentsPanel = (
    <>
      <div className="shrink-0 rounded-xl border bg-card px-4 py-3 shadow-sm">
        <h1 className="text-sm font-semibold">
          {normalizedIdentifier ? `Issue authoring: ${normalizedIdentifier}` : "New issue authoring"}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {normalizedIdentifier
            ? "Documents refresh when the assistant reports changes for the open issue. Choose Simple for a polished issue brief or Complex for a spec and implementation plan."
            : "Start by asking the assistant to draft an issue; documents appear once an identifier exists."}
        </p>
        {normalizedIdentifier ? (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-2" aria-label="Issue authoring mode">
              <Button
                type="button"
                size="sm"
                variant={issueMode === "simple" ? "default" : "outline"}
                aria-pressed={issueMode === "simple"}
                onClick={() => selectIssueMode("simple")}
              >
                Simple
              </Button>
              <Button
                type="button"
                size="sm"
                variant={issueMode === "complex" ? "default" : "outline"}
                aria-pressed={issueMode === "complex"}
                onClick={() => selectIssueMode("complex")}
              >
                Complex
              </Button>
            </div>
            {issueModeError ? (
              <p role="alert" className="text-xs text-destructive">
                {issueModeError}
              </p>
            ) : issueModeStatus ? (
              <p className="text-xs text-muted-foreground">{issueModeStatus}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {compact ? <div className="min-h-0 flex-1 overflow-hidden">{documentsContent}</div> : documentsContent}
    </>
  );

  if (compact) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden bg-muted/20 p-3">
        <section className="flex min-h-0 flex-[1.15] overflow-hidden" aria-label="Issue authoring chat">
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

function issueModeLabel(mode: IssueAssistantMode): string {
  if (mode === "simple") return "Simple";
  if (mode === "complex") return "Complex";
  return "Triage";
}
