import { assistantToolCallToView } from "@/components/assistant/assistantToolCall";
import { fileActivityFromToolCall } from "@/components/assistant/fileActivity";
import { FileActivityCard } from "@/components/assistant/FileActivityCard";
import { ToolActivityGroup } from "@/components/assistant/ToolActivityGroup";
import { ToolCallBlock } from "@/components/shared/ToolCallBlock";
import { groupToolCalls } from "@/lib/toolCallGroups";
import type { AssistantToolCall } from "@/services/assistant";

export function ToolActivityTimeline({ toolCalls }: { toolCalls: AssistantToolCall[] }) {
  if (toolCalls.length === 0) return null;

  const groups = groupToolCalls(toolCalls);

  return (
    <div className="space-y-2">
      {groups.map((group, groupIndex) => {
        if (group.calls.length > 1) {
          return <ToolActivityGroup group={group} key={`group-${group.kind}-${groupIndex}`} />;
        }

        const call = group.calls[0];
        const key = call.id && call.id.trim() !== "" ? `single-${call.id}` : `single-${call.name}-${groupIndex}`;
        const activity = fileActivityFromToolCall(call);

        return activity ? (
          <FileActivityCard view={activity} key={key} />
        ) : (
          <ToolCallBlock view={assistantToolCallToView(call)} key={key} />
        );
      })}
    </div>
  );
}
