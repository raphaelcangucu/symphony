import { ExternalLink, Rocket, Sparkles } from "lucide-react";
import type { TFunction } from "i18next";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { DocumentViewer } from "@/components/assistant/DocumentViewer";
import {
  ProjectAssistantPanel,
  type DraftIssueCreated,
  type IssueAssistantMode,
} from "@/components/assistant/ProjectAssistantPanel";
import { AgentLongRunningBadge, AgentStatusBadge } from "@/components/issues/AgentStatusBadge";
import { Button } from "@/components/ui/button";
import { useIssueDocuments } from "@/hooks/useIssueDocuments";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { composerSeedFromHandoff, consumePreviewAssistantHandoff } from "@/lib/previewAssistantHandoff";
import { issuePath, type WorkspaceView } from "@/lib/workspaceRoutes";
import { cn } from "@/lib/utils";
import type { AgentExecution } from "@/types/agent-execution";
import type { AgentKind } from "@/types/issue";
import type { AssistantDocumentChangedPayload, AssistantIssueCreatedPayload } from "@/services/phoenix/assistantChannel";

interface IssueAuthoringPanelProps {
  projectSlug: string;
  threadId?: number;
  identifier?: string;
  view: WorkspaceView;
  compact?: boolean;
  effectiveAgent?: AgentKind;
  execution?: AgentExecution;
  onDraftIssueCreated?: (issue: DraftIssueCreated) => void;
  onIssueCreated?: (issue: AssistantIssueCreatedPayload) => void;
}

export function IssueAuthoringPanel({
  projectSlug,
  threadId,
  identifier,
  view,
  compact = false,
  effectiveAgent: effectiveAgentProp,
  execution,
  onDraftIssueCreated,
  onIssueCreated,
}: IssueAuthoringPanelProps) {
  const { t } = useTranslation();
  const normalizedIdentifier = useMemo(() => normalizeIssueIdentifier(identifier) || null, [identifier]);
  const [effectiveAgent, setEffectiveAgent] = useState<AgentKind>(effectiveAgentProp ?? "codex");
  const [composerAgent, setComposerAgent] = useState<AgentKind | null>(null);
  // The composer's live selection wins the label; the server-resolved agent is
  // only the seed shown before the composer reports.
  const activeAgent: AgentKind = composerAgent ?? effectiveAgent;
  const activeAgentRef = useRef<AgentKind>(activeAgent);
  activeAgentRef.current = activeAgent;
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
  const [composerSeedMessage, setComposerSeedMessage] = useState<string | null>(null);
  const issueDocuments = useIssueDocuments({
    projectSlug,
    identifier: normalizedIdentifier,
    enabled: normalizedIdentifier !== null,
    refreshKey,
  });

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

      setRefreshKey((current) => current + 1);
    },
    [normalizedIdentifier],
  );

  const selectIssueMode = useCallback((mode: Exclude<IssueAssistantMode, "triage">) => {
    setIssueMode(mode);
    setIssueModeRequestId((current) => current + 1);
    setIssueModeError(null);
    setIssueModeStatus(t("assistant.authoring.settingMode", { mode: issueModeLabel(mode, t) }));
  }, [t]);

  const handleIssueModeChanged = useCallback((mode: IssueAssistantMode) => {
    setIssueMode(mode);
    setIssueModeError(null);
    setIssueModeStatus(t("assistant.authoring.modeActive", { mode: issueModeLabel(mode, t) }));
  }, [t]);

  const handleIssueModeError = useCallback((message: string) => {
    setIssueModeError(message);
    setIssueModeStatus(null);
  }, []);

  const toggleGoalMode = useCallback((enabled: boolean) => {
    const term = longRunningModeTerm(activeAgentRef.current, t);
    const name = agentDisplayName(activeAgentRef.current);
    setGoalMode(enabled);
    setGoalModeRequestId((current) => current + 1);
    setGoalModeError(null);
    setGoalModeStatus(
      enabled
        ? t("assistant.authoring.enablingMode", { agent: name, term })
        : t("assistant.authoring.disablingMode", { agent: name, term }),
    );
  }, [t]);

  const handleGoalModeChanged = useCallback((enabled: boolean) => {
    const term = longRunningModeTerm(activeAgentRef.current, t);
    const name = agentDisplayName(activeAgentRef.current);
    setGoalMode(enabled);
    setGoalModeError(null);
    setGoalModeStatus(
      enabled
        ? t("assistant.authoring.modeOn", { termCapitalized: capitalize(term), term, agent: name })
        : t("assistant.authoring.modeOff", { termCapitalized: capitalize(term), term }),
    );
  }, [t]);

  const handleGoalModeError = useCallback((message: string) => {
    setGoalModeError(message);
    setGoalModeStatus(null);
  }, []);

  const handleEffectiveAgentResolved = useCallback((agent: AgentKind) => {
    setEffectiveAgent(agent);
  }, []);

  const handleComposerAgentResolved = useCallback((agent: AgentKind) => {
    setComposerAgent(agent);
  }, []);

  const handleDispatch = useCallback(() => {
    setDispatching(true);
    setDispatchError(null);
    setDispatchStatus(t("assistant.authoring.dispatchingTo", { agent: agentDisplayName(activeAgentRef.current) }));
    setDispatchRequestId((current) => current + 1);
  }, [t]);

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
        "flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.02]",
      )}
    >
      {execution ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
          <AgentStatusBadge status={execution.status} />
          <AgentLongRunningBadge execution={execution} />
          {execution.goal?.objective ? (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {execution.goal.objective}
            </span>
          ) : null}
        </div>
      ) : null}
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
        onEffectiveAgentResolved={handleEffectiveAgentResolved}
        onComposerAgentResolved={handleComposerAgentResolved}
        composerSeedMessage={composerSeedMessage}
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
    <div className="rounded-2xl border border-dashed border-border/70 bg-card/60 px-6 py-10 text-center text-sm text-muted-foreground shadow-sm backdrop-blur-sm">
      {t("assistant.authoring.documentsEmpty")}
    </div>
  );

  const documentsPanel = (
    <>
      <div
        className={cn(
          "shrink-0 rounded-2xl border border-border/60 bg-gradient-to-b from-card to-muted/30 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_-14px_rgba(0,0,0,0.1)]",
          compact ? "px-3 py-3" : "px-5 py-4",
        )}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
          >
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
              {normalizedIdentifier
                ? t("assistant.authoring.titleWithId", { identifier: normalizedIdentifier })
                : t("assistant.authoring.titleNew")}
              {normalizedIdentifier ? (
                <Link
                  to={issuePath(projectSlug, view, normalizedIdentifier)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={t("assistant.authoring.openIssueAria", { identifier: normalizedIdentifier })}
                  title={t("assistant.authoring.openIssueTitle", { identifier: normalizedIdentifier })}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              ) : null}
            </h1>
            <p className={cn("text-xs leading-relaxed text-muted-foreground", compact ? "mt-0.5" : "mt-1")}>
              {normalizedIdentifier
                ? compact
                  ? t("assistant.authoring.hintCompact")
                  : t("assistant.authoring.hintFull")
                : t("assistant.authoring.hintNoId")}
            </p>
          </div>
        </div>
        {normalizedIdentifier ? (
          <div className={cn("space-y-3", compact ? "mt-3" : "mt-4")}>
            <div
              className="inline-flex w-full items-center gap-1 rounded-xl bg-muted/70 p-1 ring-1 ring-inset ring-border/50"
              aria-label={t("assistant.authoring.modeAria")}
            >
              <Button
                type="button"
                size="sm"
                variant={issueMode === "simple" ? "default" : "ghost"}
                aria-pressed={issueMode === "simple"}
                onClick={() => selectIssueMode("simple")}
                className={cn(
                  "h-8 flex-1 rounded-lg text-xs font-medium transition-all",
                  issueMode === "simple" ? "shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t("assistant.authoring.modes.simple")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={issueMode === "complex" ? "default" : "ghost"}
                aria-pressed={issueMode === "complex"}
                onClick={() => selectIssueMode("complex")}
                className={cn(
                  "h-8 flex-1 rounded-lg text-xs font-medium transition-all",
                  issueMode === "complex" ? "shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t("assistant.authoring.modes.complex")}
              </Button>
            </div>
            {issueModeError ? (
              <p role="alert" className="text-xs text-destructive">
                {issueModeError}
              </p>
            ) : issueModeStatus ? (
              <p className="text-xs text-muted-foreground">{issueModeStatus}</p>
            ) : null}
            <>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/60 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">
                    {t("assistant.authoring.longRunningLabel", {
                      agent: agentDisplayName(activeAgent),
                      term: longRunningModeTerm(activeAgent, t),
                    })}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                    {t("assistant.authoring.longRunningHint", {
                      agent: agentDisplayName(activeAgent),
                      term: longRunningModeTerm(activeAgent, t),
                    })}
                  </span>
                </span>
                <span className="relative inline-flex shrink-0 items-center">
                  <input
                    type="checkbox"
                    checked={goalMode}
                    aria-label={t("assistant.authoring.longRunningAria", {
                      agent: agentDisplayName(activeAgent),
                      term: longRunningModeTerm(activeAgent, t),
                    })}
                    onChange={(event) => toggleGoalMode(event.target.checked)}
                    className="peer sr-only"
                  />
                  <span className="h-5 w-9 rounded-full bg-input transition-colors duration-200 peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2" />
                  <span className="absolute left-0.5 h-4 w-4 rounded-full bg-background shadow-sm transition-transform duration-200 peer-checked:translate-x-4" />
                </span>
              </label>
              {goalModeError ? (
                <p role="alert" className="text-xs text-destructive">
                  {goalModeError}
                </p>
              ) : goalModeStatus ? (
                <p className="text-xs text-muted-foreground">{goalModeStatus}</p>
              ) : null}
            </>
            <div>
              <Button
                type="button"
                className="group h-10 w-full rounded-xl bg-primary text-sm font-semibold shadow-[0_4px_14px_-4px_hsl(var(--primary)/0.5)] transition-all hover:shadow-[0_6px_20px_-4px_hsl(var(--primary)/0.55)] active:scale-[0.99]"
                disabled={dispatching}
                onClick={handleDispatch}
              >
                <Rocket className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                {dispatching
                  ? t("assistant.authoring.dispatching")
                  : goalMode
                    ? t("assistant.authoring.dispatchToTerm", {
                        agent: agentDisplayName(activeAgent),
                        term: longRunningModeTerm(activeAgent, t),
                      })
                    : t("assistant.authoring.dispatchTo", { agent: agentDisplayName(activeAgent) })}
              </Button>
              <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                {t("assistant.authoring.dispatchHint", {
                  agent: agentDisplayName(activeAgent),
                  orchestrator:
                    activeAgent === "codex"
                      ? t("assistant.authoring.orchestrator")
                      : t("assistant.authoring.codingAgent"),
                  longRunningSuffix: goalMode
                    ? t("assistant.authoring.longRunningSuffix", { term: longRunningModeTerm(activeAgent, t) })
                    : "",
                })}
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

      <div className="min-h-0 flex-1 overflow-hidden">{documentsContent}</div>
    </>
  );

  if (compact) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-gradient-to-b from-muted/30 to-muted/10 p-2">
        <section className="flex min-h-0 flex-[2.4] overflow-hidden" aria-label={t("assistant.authoring.chatAria")}>
          {assistantPanel}
        </section>

        <aside className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden" aria-label={t("assistant.authoring.documentsAria")}>
          {documentsPanel}
        </aside>
      </div>
    );
  }

  return (
    <main
      className={cn(
        "grid h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] gap-5 overflow-hidden bg-gradient-to-br from-muted/40 via-background to-muted/20 p-5",
        "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(26rem,0.82fr)] xl:grid-rows-1",
      )}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">{assistantPanel}</div>

      <aside className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden" aria-label={t("assistant.authoring.documentsAria")}>
        {documentsPanel}
      </aside>
    </main>
  );
}

function issueModeLabel(mode: IssueAssistantMode, t: TFunction): string {
  if (mode === "simple") return t("assistant.authoring.modes.simple");
  if (mode === "complex") return t("assistant.authoring.modes.complex");
  return t("assistant.authoring.modes.triage");
}

function agentDisplayName(agent: AgentKind): string {
  if (agent === "claude") return "Claude";
  if (agent === "cursor") return "Cursor";
  return "Codex";
}

function longRunningModeTerm(agent: AgentKind, t: TFunction): string {
  return agent === "claude" || agent === "cursor"
    ? t("assistant.authoring.terms.workflow")
    : t("assistant.authoring.terms.goal");
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}
