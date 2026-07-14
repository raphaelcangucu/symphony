import { AssistantMarkdown } from "@/components/assistant/AssistantMarkdown";
import { ToolActivityTimeline } from "@/components/assistant/ToolActivityTimeline";
import { buildAssistantTimelineItems } from "@/components/assistant/assistantTimelineItems";
import type { AssistantContentBlock, AssistantToolCall } from "@/services/assistant";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

interface AssistantTurnTimelineProps {
  contentBlocks: readonly AssistantContentBlock[];
  toolCalls: readonly AssistantToolCall[];
  fallbackContent?: string;
  onOpenDocumentPath?: (path: string) => void;
  taskSnapshot?: AgentTaskSnapshot | null;
  onKillTool?: (toolCallId: string) => void;
}

export function AssistantTurnTimeline({
  contentBlocks,
  toolCalls,
  fallbackContent = "",
  onOpenDocumentPath,
  taskSnapshot = null,
  onKillTool,
}: AssistantTurnTimelineProps) {
  const timelineItems = buildAssistantTimelineItems(contentBlocks, toolCalls);

  if (timelineItems.length === 0 && fallbackContent.length > 0) {
    return (
      <AssistantMarkdown
        content={fallbackContent}
        onOpenDocumentPath={onOpenDocumentPath}
      />
    );
  }

  return (
    <>
      {timelineItems.map((item) => {
        if (item.type === "text") {
          return (
            <div key={item.key} className="min-w-0" data-testid="assistant-timeline-text">
              <AssistantMarkdown
                content={item.text}
                onOpenDocumentPath={onOpenDocumentPath}
              />
            </div>
          );
        }

        return (
          <div
            key={item.key}
            className="mt-2 min-w-0 border-t pt-1.5"
            data-testid="assistant-timeline-tool-run"
          >
            <ToolActivityTimeline
              toolCalls={item.toolCalls}
              taskSnapshot={taskSnapshot}
              onKillTool={onKillTool}
            />
          </div>
        );
      })}
    </>
  );
}
