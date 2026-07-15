import { AgentTaskPinnedPanel } from "@/components/agent-activity";
import {
  AssistantChatMessageBubble,
  type AssistantChatPlanApprovalAction,
} from "@/components/assistant/AssistantChatMessageBubble";
import {
  WorkingIndicator,
  type WorkingActiveToolDetail,
} from "@/components/assistant/WorkingIndicator";
import type { ComposerContextChipRef } from "@/components/assistant/contextMentions";
import type { AssistantChatMessage } from "@/services/assistant";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

/** Top-of-list control that reveals older prompts (in-memory) then fetches older server pages. */
export interface LoadOlderControl {
  label: string;
  disabled: boolean;
  onLoad: () => void;
}

interface AssistantMessageListProps {
  messages: AssistantChatMessage[];
  taskSnapshot: AgentTaskSnapshot | null;
  loadOlder?: LoadOlderControl | null;
  hidePinnedPanel?: boolean;
  projectSlug?: string;
  issueIdentifier?: string;
  threadId?: number;
  isRunning: boolean;
  runningStartedAt: number | null;
  activeToolDetail: WorkingActiveToolDetail | null;
  stale?: boolean;
  connectionError: string | null;
  channelReady: boolean;
  planApprovalMessageId: string | null;
  onOpenDocumentPath?: (path: string) => void;
  onInsertContext: (ref: ComposerContextChipRef) => void;
  onApprovePlan: AssistantChatPlanApprovalAction["onApprove"];
  onStop?: () => void;
  onKillTool?: (toolCallId: string) => void;
  onFetchToolOutput?: (messageId: string, toolCallId: string) => Promise<string>;
}

export function AssistantMessageList({
  messages,
  taskSnapshot,
  loadOlder = null,
  hidePinnedPanel = false,
  projectSlug,
  issueIdentifier,
  threadId,
  isRunning,
  runningStartedAt,
  activeToolDetail,
  stale = false,
  connectionError,
  channelReady,
  planApprovalMessageId,
  onOpenDocumentPath,
  onInsertContext,
  onApprovePlan,
  onStop,
  onKillTool,
  onFetchToolOutput,
}: AssistantMessageListProps) {
  return (
    <>
      {hidePinnedPanel ? null : <AgentTaskPinnedPanel snapshot={taskSnapshot} />}
      {loadOlder ? (
        <div className="flex justify-center pb-1">
          <button
            type="button"
            onClick={loadOlder.onLoad}
            disabled={loadOlder.disabled}
            className="rounded-full border border-border/60 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadOlder.label}
          </button>
        </div>
      ) : null}
      {messages.map((message) => (
        <AssistantChatMessageBubble
          key={message.id}
          message={message}
          projectSlug={projectSlug}
          issueIdentifier={issueIdentifier}
          threadId={threadId}
          onOpenDocumentPath={onOpenDocumentPath}
          onInsertContext={onInsertContext}
          taskSnapshot={taskSnapshot}
          onKillTool={onKillTool}
          onFetchToolOutput={onFetchToolOutput}
          planApprovalAction={
            issueIdentifier && !isRunning && message.id === planApprovalMessageId
              ? { messageId: message.id, disabled: !channelReady, onApprove: onApprovePlan }
              : undefined
          }
        />
      ))}
      {connectionError ? <p className="text-sm text-destructive">{connectionError}</p> : null}
      {isRunning && runningStartedAt != null ? (
        <WorkingIndicator
          startedAt={runningStartedAt}
          activeToolDetail={activeToolDetail}
          stale={stale}
          onStop={onStop}
          onKill={onKillTool}
        />
      ) : null}
    </>
  );
}
