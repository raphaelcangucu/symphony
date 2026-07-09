import { useTranslation } from "react-i18next";

import { AgentTaskInlineCard } from "@/components/agent-activity/AgentTaskInlineCard";
import { FileActivityCard } from "@/components/assistant/FileActivityCard";
import type { FileActivityView } from "@/components/assistant/fileActivity";
import { ToolCallBlock, type ToolCallView } from "@/components/shared/ToolCallBlock";
import { Button } from "@/components/ui/button";
import { isAgentTaskTool } from "@/lib/agentTasks";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

export interface ToolActivityItemProps {
  toolName: string;
  toolCallId?: string | null;
  view: ToolCallView;
  taskSnapshot?: AgentTaskSnapshot | null;
  fileActivity?: FileActivityView | null;
  onKillTool?: (toolCallId: string) => void;
}

/** Renders one tool invocation: task marker, file-activity card, or the standard tool block. */
export function ToolActivityItem({
  toolName,
  toolCallId = null,
  view,
  taskSnapshot,
  fileActivity,
  onKillTool,
}: ToolActivityItemProps) {
  const { t } = useTranslation();

  if (taskSnapshot && isAgentTaskTool(toolName)) {
    return <AgentTaskInlineCard snapshot={taskSnapshot} />;
  }
  if (fileActivity) return <FileActivityCard view={fileActivity} />;

  const killId = typeof toolCallId === "string" ? toolCallId.trim() : "";
  const showKill = view.status === "running" && Boolean(onKillTool) && killId.length > 0;

  if (!showKill) return <ToolCallBlock view={view} />;

  return (
    <div className="space-y-1">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onKillTool?.(killId)}
        >
          {t("assistant.working.kill")}
        </Button>
      </div>
      <ToolCallBlock view={view} />
    </div>
  );
}
