import { ExternalLink } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { DocumentViewer } from "@/components/assistant/DocumentViewer";
import {
  ProjectAssistantPanel,
  type DraftIssueCreated,
  type IssueAssistantMode,
} from "@/components/assistant/ProjectAssistantPanel";
import { Button } from "@/components/ui/button";
import { useIssueDocuments } from "@/hooks/useIssueDocuments";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { issuePath, type WorkspaceView } from "@/lib/workspaceRoutes";
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
  const [goalMode, setGoalMode] = useState(false);
  const [goalModeRequestId, setGoalModeRequestId] = useState(0);
  const [goalModeStatus, setGoalModeStatus] = useState<string | null>(null);
  const [goalModeError, setGoalModeError] = useState<string | null>(null);
  const [dispatchRequestId, setDispatchRequestId] = useState(0);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchStatus, setDispatchStatus] = useState<string | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
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

  const toggleGoalMode = useCallback((enabled: boolean) => {
    setGoalMode(enabled);
    setGoalModeRequestId((current) => current + 1);
    setGoalModeError(null);
    setGoalModeStatus(enabled ? "Enabling Codex goal mode..." : "Disabling Codex goal mode...");
  }, []);

  const handleGoalModeChanged = useCallback((enabled: boolean) => {
    setGoalMode(enabled);
    setGoalModeError(null);
    setGoalModeStatus(enabled ? "Goal mode on: Codex dispatches will follow a long-running goal." : "Goal mode off.");
  }, []);

  const handleGoalModeError = useCallback((message: string) => {
    setGoalModeError(message);
    setGoalModeStatus(null);
  }, []);

  const handleDispatch = useCallback(() => {
    setDispatching(true);
    setDispatchError(null);
    setDispatchStatus("Dispatching to Codex...");
    setDispatchRequestId((current) => current + 1);
  }, []);

  const handleDispatchSucceeded = useCallback((message: string) => {
    setDispatching(false);
    setDispatchError(null);
    setDispatchStatus(message);
  }, []);

  const handleDispatchError = useCallback((message: string) => {
    setDispatching(false);
    setDispatchError(message);
    setDispatchStatus(null);
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
        issueGoalMode={normalizedIdentifier ? goalMode : undefined}
        issueGoalModeRequestId={goalModeRequestId}
        dispatchRequestId={dispatchRequestId}
        onDocumentChanged={handleDocumentChanged}
        onDraftIssueCreated={onDraftIssueCreated}
        onIssueCreated={onIssueCreated}
        onIssueModeChanged={handleIssueModeChanged}
        onIssueModeError={handleIssueModeError}
        onIssueGoalModeChanged={handleGoalModeChanged}
        onIssueGoalModeError={handleGoalModeError}
        onDispatchSucceeded={handleDispatchSucceeded}
        onDispatchError={handleDispatchError}
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
      <div className={cn("shrink-0 rounded-xl border bg-card shadow-sm", compact ? "px-3 py-2.5" : "px-4 py-3")}>
        <h1 className="flex items-center gap-1.5 text-sm font-semibold">
          {normalizedIdentifier ? `Issue authoring: ${normalizedIdentifier}` : "New issue authoring"}
          {normalizedIdentifier ? (
            <Link
              to={issuePath(projectSlug, view, normalizedIdentifier)}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label={`Open issue ${normalizedIdentifier}`}
              title={`Open issue ${normalizedIdentifier}`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </h1>
        <p className={cn("text-xs text-muted-foreground", compact ? "mt-0.5" : "mt-1")}>
          {normalizedIdentifier
            ? compact
              ? "Simple for a polished brief, Complex for a spec + implementation plan."
              : "Documents refresh when the assistant reports changes for the open issue. Choose Simple for a polished issue brief or Complex for a spec and implementation plan."
            : "Start by asking the assistant to draft an issue; documents appear once an identifier exists."}
        </p>
        {normalizedIdentifier ? (
          <div className={cn("space-y-2", compact ? "mt-2" : "mt-3")}>
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
            <div className="border-t pt-2">
              <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={goalMode}
                  aria-label="Codex goal mode"
                  onChange={(event) => toggleGoalMode(event.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                Codex goal mode (long-running)
              </label>
              <p className="mt-1 text-[11px] text-muted-foreground">
                When on, dispatched Codex runs follow the spec/plan as a long-running goal.
              </p>
              {goalModeError ? (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  {goalModeError}
                </p>
              ) : goalModeStatus ? (
                <p className="mt-1 text-xs text-muted-foreground">{goalModeStatus}</p>
              ) : null}
            </div>
            <div className="border-t pt-2">
              <Button
                type="button"
                size="sm"
                className="w-full"
                disabled={dispatching}
                onClick={handleDispatch}
              >
                {dispatching ? "Dispatching..." : goalMode ? "Dispatch to Codex (goal)" : "Dispatch to Codex"}
              </Button>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Moves this issue to In Progress and hands it to the Codex orchestrator
                {goalMode ? " as a long-running goal" : ""}.
              </p>
              {dispatchError ? (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  {dispatchError}
                </p>
              ) : dispatchStatus ? (
                <p className="mt-1 text-xs text-muted-foreground">{dispatchStatus}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {compact ? <div className="min-h-0 flex-1 overflow-hidden">{documentsContent}</div> : documentsContent}
    </>
  );

  if (compact) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-muted/20 p-2">
        <section className="flex min-h-0 flex-[2.4] overflow-hidden" aria-label="Issue authoring chat">
          {assistantPanel}
        </section>

        <aside className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden" aria-label="Issue authoring documents">
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
