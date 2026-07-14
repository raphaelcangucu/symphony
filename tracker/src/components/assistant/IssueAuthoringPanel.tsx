import { ArrowUpRight, Sparkles } from "lucide-react";
import { memo, useCallback, useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { AssistantKbDocumentsPanel } from "@/components/assistant/AssistantKbDocumentsPanel";
import {
  ProjectAssistantPanel,
  type DraftIssueCreated,
} from "@/components/assistant/ProjectAssistantPanel";
import { IssueEditorMenu } from "@/components/issues/IssueEditorMenu";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { composerSeedFromHandoff, consumePreviewAssistantHandoff } from "@/lib/previewAssistantHandoff";
import { issuePath, type WorkspaceView } from "@/lib/workspaceRoutes";
import { cn } from "@/lib/utils";
import type { AssistantDocumentChangedPayload, AssistantIssueCreatedPayload } from "@/services/phoenix/assistantChannel";
import type { Issue } from "@/types/issue";

// The Authoring tab is scoped to the assistant conversation and its authoring goal (owned by
// `ProjectAssistantPanel`). Orchestrator execution state — including the Execution goal — lives
// on the Execution tab, so this panel intentionally does not render execution status.
interface IssueAuthoringPanelProps {
  projectSlug: string;
  threadId?: number;
  identifier?: string;
  issue?: Issue | null;
  view: WorkspaceView;
  compact?: boolean;
  onDraftIssueCreated?: (issue: DraftIssueCreated) => void;
  onIssueCreated?: (issue: AssistantIssueCreatedPayload) => void;
  onDocumentsChanged?: () => void;
}

export const IssueAuthoringPanel = memo(function IssueAuthoringPanel({
  projectSlug,
  threadId,
  identifier,
  issue,
  view,
  compact = false,
  onDraftIssueCreated,
  onIssueCreated,
  onDocumentsChanged,
}: IssueAuthoringPanelProps) {
  const { t } = useTranslation();
  const normalizedIdentifier = useMemo(() => normalizeIssueIdentifier(identifier) || null, [identifier]);
  const issueTitle = issue?.title.trim() || null;
  const issueDetailPath = normalizedIdentifier ? issuePath(projectSlug, view, normalizedIdentifier) : null;
  const [composerSeedMessage, setComposerSeedMessage] = useState<string | null>(null);
  const [kbDocumentReferences, setKbDocumentReferences] = useState<string[]>([]);
  const [requestedKbPath, setRequestedKbPath] = useState<string | null>(null);

  useEffect(() => {
    if (!normalizedIdentifier) return;

    const handoff = consumePreviewAssistantHandoff(projectSlug, normalizedIdentifier);
    if (!handoff || handoff.target !== "authoring") return;

    setComposerSeedMessage(composerSeedFromHandoff(handoff));
  }, [normalizedIdentifier, projectSlug]);

  const handleDocumentChanged = useCallback(
    (payload: AssistantDocumentChangedPayload) => {
      if (!normalizedIdentifier) return;
      if (normalizeIssueIdentifier(payload.identifier) !== normalizedIdentifier) return;

      onDocumentsChanged?.();
    },
    [normalizedIdentifier, onDocumentsChanged],
  );

  const assistantPanel = (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <ProjectAssistantPanel
        projectSlug={projectSlug}
        threadId={threadId}
        issueIdentifier={normalizedIdentifier ?? undefined}
        view={view}
        mode={compact ? "embedded" : "page"}
        onDocumentChanged={handleDocumentChanged}
        onKbDocumentReferencesChanged={setKbDocumentReferences}
        onOpenDocumentPath={setRequestedKbPath}
        onDraftIssueCreated={onDraftIssueCreated}
        onIssueCreated={onIssueCreated}
        composerSeedMessage={composerSeedMessage}
      />
    </div>
  );

  const issueContextCard =
    normalizedIdentifier && issueDetailPath ? (
      <div className="shrink-0 rounded-2xl border border-border/60 bg-card/90 px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_-14px_rgba(0,0,0,0.1)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("assistant.authoring.taskLabel")} {normalizedIdentifier}
            </p>
            <h1 className="mt-1 truncate text-base font-semibold tracking-tight">
              {issueTitle ?? t("assistant.authoring.titleLoading")}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <IssueEditorMenu projectSlug={projectSlug} identifier={normalizedIdentifier} />
            <Link
              to={issueDetailPath}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t("assistant.authoring.openIssueDetails")}
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    ) : null;

  const documentsContent = projectSlug ? (
    <AssistantKbDocumentsPanel
      projectSlug={projectSlug}
      issueIdentifier={normalizedIdentifier ?? undefined}
      citedPaths={kbDocumentReferences}
      requestedPath={requestedKbPath}
    />
  ) : (
    <div className="rounded-2xl border border-dashed border-border/70 bg-card/60 px-6 py-10 text-center text-sm text-muted-foreground shadow-sm backdrop-blur-sm">
      {t("assistant.authoring.documentsEmpty")}
    </div>
  );

  // Inside an existing issue the surrounding chrome already names the task, so the
  // documents pane stays focused on artifacts. The intro card is only useful while
  // drafting a brand-new issue that has no identifier yet.
  const documentsPanel = (
    <>
      {normalizedIdentifier ? null : (
        <div className="shrink-0 rounded-2xl border border-border/60 bg-gradient-to-b from-card to-muted/30 px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_-14px_rgba(0,0,0,0.1)]">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
            >
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-sm font-semibold tracking-tight">{t("assistant.authoring.titleNew")}</h1>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t("assistant.authoring.hintNoId")}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">{documentsContent}</div>
    </>
  );

  if (compact) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <section className="flex min-h-0 flex-1 overflow-hidden" aria-label={t("assistant.authoring.chatAria")}>
          {assistantPanel}
        </section>
      </div>
    );
  }

  return (
    <main
      className={cn(
        "grid h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] gap-5 overflow-hidden bg-background p-5",
        "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(26rem,0.82fr)] xl:grid-rows-1",
      )}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">{assistantPanel}</div>

      <aside className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden" aria-label={t("assistant.authoring.documentsAria")}>
        {issueContextCard}
        {documentsPanel}
      </aside>
    </main>
  );
});
