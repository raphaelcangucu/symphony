import { memo } from "react";

import { AssistantMarkdown } from "@/components/assistant/AssistantMarkdown";
import { ToolActivityTimeline } from "@/components/assistant/ToolActivityTimeline";
import { buildAssistantTimelineItems } from "@/components/assistant/assistantTimelineItems";
import type { OpenKbPathHandler } from "@/lib/openKbPath";
import type { AssistantContentBlock, AssistantToolCall } from "@/services/assistant";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

interface AssistantTurnTimelineProps {
  contentBlocks: readonly AssistantContentBlock[];
  toolCalls: readonly AssistantToolCall[];
  fallbackContent?: string;
  onOpenDocumentPath?: OpenKbPathHandler;
  taskSnapshot?: AgentTaskSnapshot | null;
  onKillTool?: (toolCallId: string) => void;
  onLoadFullOutput?: (toolCallId: string) => Promise<string>;
}

function AssistantTurnTimelineComponent({
  contentBlocks,
  toolCalls,
  fallbackContent = "",
  onOpenDocumentPath,
  taskSnapshot = null,
  onKillTool,
  onLoadFullOutput,
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
              onLoadFullOutput={onLoadFullOutput}
              onOpenKbPath={onOpenDocumentPath}
            />
          </div>
        );
      })}
    </>
  );
}

// Memoized so a streaming sibling message does not rerender settled turn timelines.
export const AssistantTurnTimeline = memo(AssistantTurnTimelineComponent);
