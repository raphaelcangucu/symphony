import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AssistantSessionShell } from "@/components/assistant/AssistantSessionShell";
import { CHAT_READING_COLUMN_CLASS } from "@/components/assistant/chatTypography";
import { attachChatScrollStickiness } from "@/components/assistant/chatScrollStickiness";
import { BundlePanel } from "@/components/issues/issue-detail/BundlePanel";
import { ExecutionControlComposer } from "@/components/issues/issue-detail/ExecutionControlComposer";
import { ExecutionStatusHeader } from "@/components/issues/issue-detail/ExecutionStatusHeader";
import { IssueSessionLog } from "@/components/issues/issue-detail/IssueSessionLog";
import { ReturnToAgentPanel } from "@/components/issues/issue-detail/ReturnToAgentPanel";
import { Button } from "@/components/ui/button";
import { useSessionLogChannel } from "@/hooks/useSessionLogChannel";
import { canResumeExecution, canSteerExecution } from "@/lib/agentExecutionDisplay";
import { assessEvidenceAttention, type EvidenceAttention } from "@/lib/evidenceStatus";
import type { ReturnToAgentTemplate } from "@/lib/returnToAgent";
import { cn } from "@/lib/utils";
import { isWaitState, parseWorkflowTrackerConfig, type WorkflowTrackerConfig } from "@/lib/workflowTracker";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

interface ExecutionChatPanelProps {
  issue: Issue;
  execution?: AgentExecution;
  executions?: AgentExecution[];
  projectSlug: string;
  workflowMarkdown?: string | null;
  evidenceAttention?: EvidenceAttention;
  returnToAgentTemplate?: ReturnToAgentTemplate | null;
  steerSeedMessage?: string | null;
  showExecutionStatus?: boolean;
  onIssueUpdated?: (updated: Issue) => void;
}

/**
 * Autonomous execution surface — same shell, reading column, and typography as
 * the interactive assistant chat so layout changes stay in one place.
 */
export function ExecutionChatPanel({
  issue,
  execution,
  executions,
  projectSlug,
  workflowMarkdown = null,
  evidenceAttention,
  returnToAgentTemplate = null,
  steerSeedMessage = null,
  showExecutionStatus = false,
  onIssueUpdated,
}: ExecutionChatPanelProps) {
  const { t } = useTranslation();
  const trackerConfig: WorkflowTrackerConfig = parseWorkflowTrackerConfig(workflowMarkdown);
  const inWaitState = isWaitState(issue.status, trackerConfig);
  const showReturnPanel = inWaitState && canResumeExecution(execution);
  const resolvedEvidenceAttention = evidenceAttention ?? assessEvidenceAttention([]);
  const bundleExecutions = executions ?? (execution ? [execution] : []);

  const sessionLog = useSessionLogChannel({
    projectSlug,
    issueIdentifier: issue.identifier,
    enabled: true,
    agentKind: execution?.agentKind ?? issue.agentKind ?? null,
  });
  const canSteer = canSteerExecution(execution);

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
  }, [sessionLog.entries]);

  const composer = (
    <ExecutionControlComposer
      projectSlug={projectSlug}
      issue={issue}
      execution={execution}
      sessionConnected={sessionLog.connected}
      canSteer={canSteer}
      steerPending={sessionLog.steerPending}
      steerError={sessionLog.steerError}
      seedMessage={steerSeedMessage}
      onSteer={sessionLog.steerTurn}
      onIssueUpdated={onIssueUpdated}
    />
  );

  // Status sits in the shell toolbar (outside the scroller) so toggling it is
  // visible next to the header control even when the transcript is stuck to bottom.
  const statusToolbar = showExecutionStatus ? (
    <div className={cn(CHAT_READING_COLUMN_CLASS, "pb-2 pt-1")}>
      <ExecutionStatusHeader
        projectSlug={projectSlug}
        issue={issue}
        execution={execution}
        onIssueUpdated={onIssueUpdated}
      />
    </div>
  ) : null;

  const feedTop = (
    <div className="space-y-3">
      <BundlePanel issue={issue} executions={bundleExecutions} />
      {showReturnPanel ? (
        <ReturnToAgentPanel
          projectSlug={projectSlug}
          issue={issue}
          trackerConfig={trackerConfig}
          evidenceAttention={resolvedEvidenceAttention}
          initialTemplate={returnToAgentTemplate}
          onIssueUpdated={onIssueUpdated}
        />
      ) : null}
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
    <AssistantSessionShell
      className="min-h-0 flex-1"
      toolbar={statusToolbar}
      feedRef={setScrollContainerRef}
      feed={
        <div className={cn(CHAT_READING_COLUMN_CLASS, "flex w-full flex-col gap-4 py-4")}>
          {feedTop}
          <IssueSessionLog
            variant="shell-feed"
            issueIdentifier={issue.identifier}
            connected={sessionLog.connected}
            entries={sessionLog.entries}
            error={sessionLog.error}
            logAgentKind={sessionLog.logAgentKind}
            preferredAgentKind={sessionLog.preferredAgentKind ?? execution?.agentKind ?? issue.agentKind}
          />
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
  );
}
