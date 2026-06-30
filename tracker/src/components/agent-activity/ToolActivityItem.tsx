import { AgentTaskInlineCard } from "@/components/agent-activity/AgentTaskInlineCard";
import { FileActivityCard } from "@/components/assistant/FileActivityCard";
import type { FileActivityView } from "@/components/assistant/fileActivity";
import { ToolCallBlock, type ToolCallView } from "@/components/shared/ToolCallBlock";
import { isAgentTaskTool } from "@/lib/agentTasks";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

export interface ToolActivityItemProps {
  toolName: string;
  view: ToolCallView;
  taskSnapshot?: AgentTaskSnapshot | null;
  fileActivity?: FileActivityView | null;
}

/** Renders one tool invocation: task marker, file-activity card, or the standard tool block. */
export function ToolActivityItem({ toolName, view, taskSnapshot, fileActivity }: ToolActivityItemProps) {
  if (taskSnapshot && isAgentTaskTool(toolName)) {
    return <AgentTaskInlineCard snapshot={taskSnapshot} />;
  }
  if (fileActivity) return <FileActivityCard view={fileActivity} />;
  return <ToolCallBlock view={view} />;
}
