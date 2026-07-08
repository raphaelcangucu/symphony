import { AgentTaskPinnedPanel } from "@/components/agent-activity";
import {
  AssistantChatMessageBubble,
  type AssistantChatPlanApprovalAction,
} from "@/components/assistant/AssistantChatMessageBubble";
import { WorkingIndicator } from "@/components/assistant/WorkingIndicator";
import type { ComposerContextChipRef } from "@/components/assistant/contextMentions";
import type { AssistantChatMessage } from "@/services/assistant";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

interface AssistantMessageListProps {
  messages: AssistantChatMessage[];
  taskSnapshot: AgentTaskSnapshot | null;
  hidePinnedPanel?: boolean;
  projectSlug?: string;
  issueIdentifier?: string;
  threadId?: number;
  isRunning: boolean;
  runningStartedAt: number | null;
  activeTool: string | null;
  connectionError: string | null;
  channelReady: boolean;
  planApprovalMessageId: string | null;
  onOpenDocumentPath?: (path: string) => void;
  onInsertContext: (ref: ComposerContextChipRef) => void;
  onApprovePlan: AssistantChatPlanApprovalAction["onApprove"];
}

export function AssistantMessageList({
  messages,
  taskSnapshot,
  hidePinnedPanel = false,
  projectSlug,
  issueIdentifier,
  threadId,
  isRunning,
  runningStartedAt,
  activeTool,
  connectionError,
  channelReady,
  planApprovalMessageId,
  onOpenDocumentPath,
  onInsertContext,
  onApprovePlan,
}: AssistantMessageListProps) {
  return (
    <>
      {hidePinnedPanel ? null : <AgentTaskPinnedPanel snapshot={taskSnapshot} />}
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
          planApprovalAction={
            issueIdentifier && !isRunning && message.id === planApprovalMessageId
              ? { messageId: message.id, disabled: !channelReady, onApprove: onApprovePlan }
              : undefined
          }
        />
      ))}
      {connectionError ? <p className="text-sm text-destructive">{connectionError}</p> : null}
      {isRunning && runningStartedAt != null ? (
        <WorkingIndicator startedAt={runningStartedAt} activeTool={activeTool} />
      ) : null}
    </>
  );
}
