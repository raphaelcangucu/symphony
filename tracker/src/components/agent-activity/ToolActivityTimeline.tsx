import { assistantToolCallToView } from "@/components/assistant/assistantToolCall";
import { fileActivityFromToolCall } from "@/components/assistant/fileActivity";
import { ToolActivityGroup } from "@/components/agent-activity/ToolActivityGroup";
import { ToolActivityItem } from "@/components/agent-activity/ToolActivityItem";
import { groupToolCalls } from "@/lib/toolCallGroups";
import type { AgentTaskSnapshot } from "@/types/agentTasks";
import type { AssistantToolCall } from "@/services/assistant";

interface ToolActivityTimelineProps {
  toolCalls: AssistantToolCall[];
  taskSnapshot?: AgentTaskSnapshot | null;
  onKillTool?: (toolCallId: string) => void;
}

export function ToolActivityTimeline({
  toolCalls,
  taskSnapshot = null,
  onKillTool,
}: ToolActivityTimelineProps) {
  if (toolCalls.length === 0) return null;

  const groups = groupToolCalls(toolCalls);

  return (
    <div className="space-y-2">
      {groups.map((group, groupIndex) => {
        if (group.calls.length > 1) {
          return (
            <ToolActivityGroup
              group={group}
              taskSnapshot={taskSnapshot}
              onKillTool={onKillTool}
              key={`group-${group.kind}-${groupIndex}`}
            />
          );
        }

        const call = group.calls[0];
        const key = call.id && call.id.trim() !== "" ? `single-${call.id}` : `single-${call.name}-${groupIndex}`;

        return (
          <ToolActivityItem
            key={key}
            toolName={call.name}
            toolCallId={call.id}
            view={assistantToolCallToView(call)}
            taskSnapshot={taskSnapshot}
            fileActivity={fileActivityFromToolCall(call)}
            onKillTool={onKillTool}
          />
        );
      })}
    </div>
  );
}
