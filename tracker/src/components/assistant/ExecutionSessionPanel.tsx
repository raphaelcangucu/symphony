import { ChevronDown } from "lucide-react";
import axios from "axios";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AssistantMessageList } from "@/components/assistant/AssistantMessageList";
import { AssistantSessionErrorBoundary } from "@/components/assistant/AssistantSessionErrorBoundary";
import { AssistantSessionShell } from "@/components/assistant/AssistantSessionShell";
import { CHAT_READING_COLUMN_CLASS } from "@/components/assistant/chatTypography";
import { attachChatScrollStickiness } from "@/components/assistant/chatScrollStickiness";
import { useExecutionSessionMode } from "@/components/assistant/useExecutionSessionMode";
import { usePublishSessionTasksDockFeed } from "@/components/sessions/sessionTasksDockFeedContext";
import { BundlePanel } from "@/components/issues/issue-detail/BundlePanel";
import { ExecutionControlComposer } from "@/components/issues/issue-detail/ExecutionControlComposer";
import { ExecutionStatusHeader } from "@/components/issues/issue-detail/ExecutionStatusHeader";
import { GitDiffLauncher } from "@/components/issues/issue-detail/git-diff/GitDiffLauncher";
import { ReturnToAgentPanel } from "@/components/issues/issue-detail/ReturnToAgentPanel";
import { Button } from "@/components/ui/button";
import { assessEvidenceAttention } from "@/lib/evidenceStatus";
import { canResumeExecution } from "@/lib/agentExecutionDisplay";
import { buildExecutionSessionFallbackIssue } from "@/lib/executionSessionIssue";
import { messagesFromSessionLogFeed } from "@/lib/sessionLogFeed";
import { cn } from "@/lib/utils";
import { isWaitState, parseWorkflowTrackerConfig } from "@/lib/workflowTracker";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import { getIssue } from "@/services/issues";
import type { Issue } from "@/types/issue";

export interface ExecutionSessionPanelProps {
  projectSlug: string;
  threadId: number;
  issueIdentifier: string;
  composerSeedMessage?: string | null;
  hideHeader?: boolean;
  diffRequestId?: number;
}

/**
 * Orchestrator issue_execution surface inside the unified assistant shell.
 * Body is fed by session_log (adapted feed); composer uses steer/queue/resume
 * semantics. Does not push send_message on the assistant channel.
 */
export function ExecutionSessionPanel({
  projectSlug,
  threadId,
  issueIdentifier,
  composerSeedMessage = null,
  diffRequestId = 0,
}: ExecutionSessionPanelProps) {
  const { t } = useTranslation();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);

  const session = useExecutionSessionMode({
    projectSlug,
    threadId,
    issueIdentifier,
    enabled: true,
    agentKind: issue?.agentKind ?? null,
  });

  useEffect(() => {
    let active = true;
    setIssueError(null);
    setIssue((current) =>
      current?.identifier === issueIdentifier
        ? current
        : buildExecutionSessionFallbackIssue(projectSlug, issueIdentifier, session.execution),
    );

    void getIssue(projectSlug, issueIdentifier)
      .then((next) => {
        if (active) setIssue(next);
      })
      .catch((cause) => {
        if (!active) return;
        setIssue((current) =>
          current?.identifier === issueIdentifier
            ? current
            : buildExecutionSessionFallbackIssue(projectSlug, issueIdentifier, session.execution),
        );
        if (axios.isAxiosError(cause)) {
          const message = (cause.response?.data as { error?: { message?: string } } | undefined)?.error
            ?.message;
          if (message?.trim()) {
            setIssueError(message.trim());
            return;
          }
        }
        setIssueError(cause instanceof Error ? cause.message : t("issue.agent.dispatchFailed"));
      });

    return () => {
      active = false;
    };
  }, [
    issueIdentifier,
    projectSlug,
    session.execution?.agentKind,
    session.execution?.model,
    t,
  ]);

  const toolItems = useMemo(
    () => messagesFromSessionLogFeed(session.feedItems).flatMap((message) => message.toolCalls),
    [session.feedItems],
  );
  usePublishSessionTasksDockFeed({ tasks: session.taskSnapshot, toolItems });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const pinnedScrollTopRef = useRef<number | null>(null);
  const scrollStickinessCleanupRef = useRef<(() => void) | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const setScrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node && scrollRef.current && !stickToBottomRef.current) {
      pinnedScrollTopRef.current = scrollRef.current.scrollTop;
    }

    scrollStickinessCleanupRef.current?.();
    scrollStickinessCleanupRef.current = null;
    scrollRef.current = node;
    if (node) {
      scrollStickinessCleanupRef.current = attachChatScrollStickiness(
        node,
        stickToBottomRef,
        pinnedScrollTopRef,
        setIsAtBottom,
      );
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    stickToBottomRef.current = true;
    pinnedScrollTopRef.current = null;
    setIsAtBottom(true);
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => () => scrollStickinessCleanupRef.current?.(), []);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !stickToBottomRef.current) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [session.feedItems]);

  const handleIssueUpdated = useCallback((updated: Issue) => {
    setIssue(updated);
  }, []);

  const trackerConfig = parseWorkflowTrackerConfig(null);
  const inWaitState = issue ? isWaitState(issue.status, trackerConfig) : false;
  const showReturnPanel = Boolean(issue && inWaitState && canResumeExecution(session.execution));

  const statusToolbar = issue ? (
    <div className={cn(CHAT_READING_COLUMN_CLASS, "pb-2 pt-1")}>
      <ExecutionStatusHeader
        projectSlug={projectSlug}
        issue={issue}
        execution={session.execution}
        onIssueUpdated={handleIssueUpdated}
      />
    </div>
  ) : null;

  const feedTop = issue ? (
    <div className="space-y-3">
      <BundlePanel issue={issue} executions={session.executions} />
      {showReturnPanel ? (
        <ReturnToAgentPanel
          projectSlug={projectSlug}
          issue={issue}
          trackerConfig={trackerConfig}
          evidenceAttention={assessEvidenceAttention([])}
          initialTemplate={null}
          onIssueUpdated={handleIssueUpdated}
        />
      ) : null}
    </div>
  ) : null;

  const messageItems = (
    <AssistantSessionErrorBoundary
      title={t("assistant.panel.renderErrorTitle")}
      description={t("assistant.panel.renderErrorDescription")}
      retryLabel={t("assistant.panel.renderErrorRetry")}
      onReset={() => {
        // Session-log channel re-joins on remount; no assistant history sync.
      }}
    >
      <AssistantMessageList
        feedItems={session.feedItems}
        taskSnapshot={session.taskSnapshot}
        projectSlug={projectSlug}
        issueIdentifier={issueIdentifier}
        threadId={threadId}
        isRunning={session.isActive && session.canSteer}
        runningStartedAt={null}
        activeToolDetail={null}
        connectionError={session.error ?? issueError}
        channelReady={session.connected}
        planApprovalMessageId={null}
        onInsertContext={() => {
          /* Mentions insert into the execution composer via its own handlers. */
        }}
        onApprovePlan={() => {
          /* Plan approval is interactive-only. */
        }}
      />
    </AssistantSessionErrorBoundary>
  );

  const composer =
    issue != null ? (
      <ExecutionControlComposer
        projectSlug={projectSlug}
        issue={issue}
        execution={session.execution}
        sessionConnected={session.connected}
        canSteer={session.canSteer}
        steerPending={session.steerPending}
        steerError={session.steerError}
        seedMessage={composerSeedMessage}
        onSteer={session.steerTurn}
        onIssueUpdated={handleIssueUpdated}
      />
    ) : (
      <div className="rounded-2xl border bg-card px-4 py-6 text-sm text-muted-foreground shadow-sm">
        {issueError ?? t("assistant.panel.loadingModels")}
      </div>
    );

  const scrollToBottomButton = !isAtBottom ? (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-4">
      <Button
        type="button"
        size="icon"
        variant="secondary"
        aria-label={t("issue.sessionLog.scrollToBottom")}
        title={t("issue.sessionLog.scrollToBottom")}
        onClick={scrollToBottom}
        className="pointer-events-auto h-8 w-8 rounded-full border bg-background/95 shadow-md backdrop-blur-sm"
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
    </div>
  ) : null;

  return (
    <section
      className="relative flex h-full min-h-0"
      aria-label={t("assistant.panel.ariaLabel")}
      data-testid="execution-session-panel"
      data-execution-mode="true"
    >
      <AssistantSessionShell
        className="min-w-0 flex-1"
        toolbar={statusToolbar}
        feedRef={setScrollContainerRef}
        feed={
          <div className={cn(CHAT_READING_COLUMN_CLASS, "flex w-full flex-col gap-4 py-4")}>
            {feedTop}
            {messageItems}
          </div>
        }
        feedOverlay={scrollToBottomButton}
        composer={
          <div className={cn("bg-background py-2", CHAT_READING_COLUMN_CLASS)}>
            {showReturnPanel ? (
              <details className="rounded-xl border border-border/70 bg-card/20 p-3">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                  {t("issue.agent.advancedControls")}
                </summary>
                <div className="mt-3">{composer}</div>
              </details>
            ) : (
              composer
            )}
          </div>
        }
      />
      <GitDiffLauncher
        projectSlug={projectSlug}
        identifier={issueIdentifier}
        threadId={threadId}
        disabled={issue == null}
        onSendReview={(review) => {
          void dispatchIssueAgent(projectSlug, issueIdentifier, {
            action: "resume",
            instructions: review,
          }).then((result) => {
            setIssue(result.issue);
          });
        }}
        openRequestId={diffRequestId}
        showTrigger={false}
      />
    </section>
  );
}
