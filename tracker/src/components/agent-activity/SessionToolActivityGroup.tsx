import { ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ToolActivityItem } from "@/components/agent-activity/ToolActivityItem";
import { TOOL_GROUP_ICON } from "@/components/agent-activity/toolGroupIcons";
import { sessionPairToView, type SessionToolPair } from "@/components/issues/issue-detail/sessionToolCall";
import { cn } from "@/lib/utils";
import type { ToolGroupKind, ToolGroupStatus } from "@/lib/toolCallGroups";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

interface SessionToolActivityGroupProps {
  kind: ToolGroupKind;
  status: ToolGroupStatus;
  pairs: SessionToolPair[];
  taskSnapshot?: AgentTaskSnapshot | null;
}

/**
 * Collapsible group for a run of consecutive same-kind session-log tool calls,
 * mirroring the assistant chat's `ToolActivityGroup` but driven by paired
 * session-log entries rather than assistant tool-call objects.
 */
export function SessionToolActivityGroup({ kind, status, pairs, taskSnapshot = null }: SessionToolActivityGroupProps) {
  const { t } = useTranslation();
  const running = status === "running";
  const failed = status === "error";
  const [open, setOpen] = useState(() => failed || kind === "action");
  const Icon = TOOL_GROUP_ICON[kind];

  return (
    <article
      className={cn(
        "overflow-hidden rounded-xl border",
        failed ? "border-destructive/40 bg-destructive/5" : "border-border/60 bg-muted/30",
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-busy={running}
        data-testid="session-tool-activity-group"
      >
        <span className="shrink-0 text-muted-foreground">
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {t(`assistant.toolGroup.${kind}`, { n: pairs.length })}
        </span>
        {failed ? (
          <span className="shrink-0 rounded-full border border-destructive/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-destructive">
            {t("assistant.toolGroup.failed")}
          </span>
        ) : running ? (
          <span className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("assistant.toolGroup.running")}
          </span>
        ) : null}
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border/60 px-3 py-2.5">
          {pairs.map((pair, index) => (
            <ToolActivityItem
              key={`session-tool-${pair.call.callId ?? pair.call.title}-${index}`}
              toolName={pair.call.title}
              view={sessionPairToView(pair.call, pair.result)}
              taskSnapshot={taskSnapshot}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}
