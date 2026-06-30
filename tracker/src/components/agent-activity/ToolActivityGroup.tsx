import { ChevronDown, FileText, Loader2, type LucideIcon, Pencil, Search, TerminalSquare, Wrench, Zap } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ToolActivityItem } from "@/components/agent-activity/ToolActivityItem";
import { assistantToolCallToView } from "@/components/assistant/assistantToolCall";
import { fileActivityFromToolCall } from "@/components/assistant/fileActivity";
import { summarizeGroup, type ToolCallGroup, type ToolGroupKind, type ToolGroupSummary } from "@/lib/toolCallGroups";
import { cn } from "@/lib/utils";
import type { AgentTaskSnapshot } from "@/types/agentTasks";
import type { AssistantToolCall } from "@/services/assistant";

const KIND_ICON: Record<ToolGroupKind, LucideIcon> = {
  read: FileText,
  edit: Pencil,
  command: TerminalSquare,
  query: Search,
  action: Zap,
  other: Wrench,
};

function defaultOpen(group: ToolCallGroup): boolean {
  if (group.status === "error") return true;
  return group.kind === "action";
}

function rowKey(call: AssistantToolCall, index: number): string {
  return call.id && call.id.trim() !== "" ? `tc-${call.id}` : `tc-${call.name}-${index}`;
}

function groupLabel(
  group: ToolCallGroup,
  summary: ToolGroupSummary,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (group.kind === "edit" && (summary.additions > 0 || summary.deletions > 0)) {
    return t("assistant.toolGroup.editStats", {
      n: summary.count,
      additions: summary.additions,
      deletions: summary.deletions,
    });
  }
  return t(`assistant.toolGroup.${group.kind}`, { n: summary.count });
}

interface ToolActivityGroupProps {
  group: ToolCallGroup;
  taskSnapshot?: AgentTaskSnapshot | null;
}

export function ToolActivityGroup({ group, taskSnapshot = null }: ToolActivityGroupProps) {
  const { t } = useTranslation();
  const summary = summarizeGroup(group);
  const [open, setOpen] = useState(() => defaultOpen(group));
  const running = group.status === "running";
  const failed = group.status === "error";
  const Icon = KIND_ICON[group.kind];

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
        data-testid="tool-activity-group"
      >
        <span className="shrink-0 text-muted-foreground">
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {groupLabel(group, summary, t)}
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
          {group.calls.map((call, index) => (
            <ToolActivityItem
              key={rowKey(call, index)}
              toolName={call.name}
              view={assistantToolCallToView(call)}
              taskSnapshot={taskSnapshot}
              fileActivity={fileActivityFromToolCall(call)}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}
