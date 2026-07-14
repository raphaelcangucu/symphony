import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ActivityDisclosure } from "@/components/agent-activity/ActivityDisclosure";
import { ToolActivityItem } from "@/components/agent-activity/ToolActivityItem";
import { TOOL_GROUP_ICON } from "@/components/agent-activity/toolGroupIcons";
import { sessionPairToView, type SessionToolPair } from "@/components/issues/issue-detail/sessionToolCall";
import type { ToolGroupKind, ToolGroupStatus } from "@/lib/toolCallGroups";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

interface SessionToolActivityGroupProps {
  kind: ToolGroupKind;
  status: ToolGroupStatus;
  pairs: SessionToolPair[];
  taskSnapshot?: AgentTaskSnapshot | null;
}

/**
 * Same ActivityDisclosure chrome as interactive `ToolActivityGroup`, driven by
 * paired session-log tool calls.
 */
export function SessionToolActivityGroup({
  kind,
  status,
  pairs,
  taskSnapshot = null,
}: SessionToolActivityGroupProps) {
  const { t } = useTranslation();
  const running = status === "running";
  const failed = status === "error";
  const [open, setOpen] = useState(() => failed || kind === "action");
  const Icon = TOOL_GROUP_ICON[kind];

  return (
    <ActivityDisclosure
      icon={running ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
      label={t(`assistant.toolGroup.${kind}`, { n: pairs.length })}
      status={failed ? "failed" : running ? "running" : null}
      statusLabel={
        failed ? t("assistant.toolGroup.failed") : running ? t("assistant.toolGroup.running") : undefined
      }
      testId="session-tool-activity-group"
      expanded={open}
      onExpandedChange={setOpen}
      details={
        <div className="space-y-0.5">
          {pairs.map((pair, index) => (
            <ToolActivityItem
              key={`session-tool-${pair.call.callId ?? pair.call.title}-${index}`}
              toolName={pair.call.title}
              view={sessionPairToView(pair.call, pair.result)}
              taskSnapshot={taskSnapshot}
            />
          ))}
        </div>
      }
    />
  );
}
