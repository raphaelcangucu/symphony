import { AgentTaskPinnedPanel } from "@/components/agent-activity";
import { SubagentNotificationCard } from "@/components/agent-activity/SubagentNotificationCard";
import {
  AssistantChatMessageBubble,
  type AssistantChatPlanApprovalAction,
} from "@/components/assistant/AssistantChatMessageBubble";
import {
  SessionLogFeedDisclosure,
  SessionLogFeedEventGroup,
} from "@/components/assistant/SessionLogFeedItems";
import {
  WorkingIndicator,
  type WorkingActiveToolDetail,
} from "@/components/assistant/WorkingIndicator";
import type { OpenWorkspaceDiffRequest } from "@/components/assistant/EditedFilesSummary";
import type { ComposerContextChipRef } from "@/components/assistant/contextMentions";
import type { ToolActivityTimings } from "@/components/assistant/toolActivityTiming";
import type { OpenKbPathHandler } from "@/lib/openKbPath";
import type { SessionLogFeedItem } from "@/lib/sessionLogFeed";
import type { AssistantChatMessage } from "@/services/assistant";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

/** Top-of-list control that reveals older prompts (in-memory) then fetches older server pages. */
export interface LoadOlderControl {
  label: string;
  disabled: boolean;
  onLoad: () => void;
}

interface AssistantMessageListProps {
  /**
   * Interactive history. Ignored when `feedItems` is provided (execution mode
   * uses the adapted session-log feed as the sole body source).
   */
  messages?: AssistantChatMessage[];
  /**
   * Unified session-log feed (`message` | `disclosure` | `event_group` | `subagent_notification`).
   * When set, replaces `messages` as the body source.
   */
  feedItems?: SessionLogFeedItem[];
  taskSnapshot: AgentTaskSnapshot | null;
  loadOlder?: LoadOlderControl | null;
  hidePinnedPanel?: boolean;
  projectSlug?: string;
  issueIdentifier?: string;
  threadId?: number;
  isRunning: boolean;
  runningStartedAt: number | null;
  activeToolDetail: WorkingActiveToolDetail | null;
  toolTimings?: ToolActivityTimings;
  stale?: boolean;
  connectionError: string | null;
  channelReady: boolean;
  planApprovalMessageId: string | null;
  onOpenDocumentPath?: OpenKbPathHandler;
  onInsertContext: (ref: ComposerContextChipRef) => void;
  onOpenWorkspaceDiff?: (request: OpenWorkspaceDiffRequest) => void;
  onApprovePlan: AssistantChatPlanApprovalAction["onApprove"];
  onKillTool?: (toolCallId: string) => void;
  onFetchToolOutput?: (
    messageId: string,
    toolCallId: string,
  ) => Promise<string>;
}

export function AssistantMessageList({
  messages = [],
  feedItems,
  taskSnapshot,
  loadOlder = null,
  hidePinnedPanel = false,
  projectSlug,
  issueIdentifier,
  threadId,
  isRunning,
  runningStartedAt,
  activeToolDetail,
  toolTimings = {},
  stale = false,
  connectionError,
  channelReady,
  planApprovalMessageId,
  onOpenDocumentPath,
  onInsertContext,
  onOpenWorkspaceDiff,
  onApprovePlan,
  onKillTool,
  onFetchToolOutput,
}: AssistantMessageListProps) {
  const useFeed = Array.isArray(feedItems);
  const renderedMessages = useFeed
    ? feedItems
        .filter((item) => item.type === "message")
        .map((item) => item.message)
    : messages;
  const activeToolRepresented = containsActiveTool(
    renderedMessages,
    activeToolDetail,
  );

  return (
    <>
      {hidePinnedPanel ? null : (
        <AgentTaskPinnedPanel snapshot={taskSnapshot} />
      )}
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
      {useFeed
        ? feedItems.map((item) => {
            if (item.type === "disclosure") {
              return <SessionLogFeedDisclosure key={item.id} item={item} />;
            }
            if (item.type === "event_group") {
              return <SessionLogFeedEventGroup key={item.id} item={item} />;
            }
            if (item.type === "subagent_notification") {
              return (
                <SubagentNotificationCard
                  key={item.id}
                  notification={item.notification}
                />
              );
            }
            return (
              <AssistantChatMessageBubble
                key={item.id}
                message={item.message}
                projectSlug={projectSlug}
                issueIdentifier={issueIdentifier}
                threadId={threadId}
                onOpenDocumentPath={onOpenDocumentPath}
                onInsertContext={onInsertContext}
                onOpenWorkspaceDiff={onOpenWorkspaceDiff}
                taskSnapshot={taskSnapshot}
                onKillTool={onKillTool}
                onFetchToolOutput={onFetchToolOutput}
                toolTimings={toolTimings}
              />
            );
          })
        : messages.map((message) => (
            <AssistantChatMessageBubble
              key={message.id}
              message={message}
              projectSlug={projectSlug}
              issueIdentifier={issueIdentifier}
              threadId={threadId}
              onOpenDocumentPath={onOpenDocumentPath}
              onInsertContext={onInsertContext}
              onOpenWorkspaceDiff={onOpenWorkspaceDiff}
              taskSnapshot={taskSnapshot}
              onKillTool={onKillTool}
              onFetchToolOutput={onFetchToolOutput}
              toolTimings={toolTimings}
              planApprovalAction={
                issueIdentifier &&
                !isRunning &&
                message.id === planApprovalMessageId
                  ? {
                      messageId: message.id,
                      disabled: !channelReady,
                      onApprove: onApprovePlan,
                    }
                  : undefined
              }
            />
          ))}
      {connectionError ? (
        <p className="text-sm text-destructive">{connectionError}</p>
      ) : null}
      {isRunning && runningStartedAt != null && !activeToolRepresented ? (
        <WorkingIndicator
          startedAt={runningStartedAt}
          activeToolDetail={activeToolDetail}
          stale={stale}
          onKill={onKillTool}
        />
      ) : null}
    </>
  );
}

function containsActiveTool(
  messages: readonly AssistantChatMessage[],
  active: WorkingActiveToolDetail | null,
): boolean {
  if (!active) return false;

  return messages.some((message) =>
    message.toolCalls.some(
      (call) =>
        call.status === "running" &&
        (call.id ? call.id === active.id : call.name === active.name),
    ),
  );
}
