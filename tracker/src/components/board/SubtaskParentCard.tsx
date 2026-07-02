import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, GitFork, Layers } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { issueDisplayIdentifier } from "@/lib/issueIdentifiers";
import { cn } from "@/lib/utils";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { WorkflowStatusCategory, WorkflowStatusName } from "@/types/workflow-status";

import { getStatusMeta } from "./status-meta";
import { MergeDropOverlay, ReorderDropLine } from "./MergeDropOverlay";
import { IssueCard } from "./IssueCard";

interface SubtaskParentCardProps {
  id: string;
  issue: Issue;
  subtasks: Issue[];
  onSelectIssue: (issue: Issue) => void;
  agent?: AgentExecution;
  mergeActive?: boolean;
  dropEdge?: "top" | "bottom" | null;
  statusCategory?: (status: WorkflowStatusName) => WorkflowStatusCategory | null;
}

/**
 * Board card for an issue that owns sub-issues. A single draggable wrapper holds
 * a count/toggle header on top, the parent issue card (rendered presentationally
 * so the wrapper is the one draggable unit), and an expandable list of sub-issues
 * underneath.
 */
export function SubtaskParentCard({
  id,
  issue,
  subtasks,
  onSelectIssue,
  agent,
  mergeActive = false,
  dropEdge = null,
  statusCategory,
}: SubtaskParentCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    touchAction: "none",
  } satisfies React.CSSProperties;

  const summary = issue.subIssueSummary;
  const count = summary?.total ?? subtasks.length;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative rounded-xl border border-border/70 bg-muted/30 p-1.5 shadow-sm transition-all",
        isDragging && "opacity-40",
        mergeActive && "border-primary ring-2 ring-primary ring-offset-1 ring-offset-background",
      )}
      {...attributes}
      {...listeners}
    >
      {mergeActive ? <MergeDropOverlay /> : null}
      {dropEdge && !mergeActive ? <ReorderDropLine edge={dropEdge} /> : null}
      <div className="mb-1 flex items-center justify-between px-1 pt-0.5">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          title={expanded ? t("board.subtasks.collapse") : t("board.subtasks.expand")}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Layers className="h-3 w-3" />
          {t("board.subtasks.count", { count })}
        </button>
        {summary ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            {summary.completed} / {summary.total}
          </span>
        ) : null}
      </div>

      <IssueCard issue={issue} onSelect={onSelectIssue} agent={agent} presentational />

      {expanded ? (
        <div className="mt-1.5 space-y-1 border-l-2 border-border/60 pl-2">
          {subtasks.length === 0 ? (
            <p className="px-2 py-1 text-[10px] text-muted-foreground">{t("board.subtasks.empty")}</p>
          ) : (
            subtasks.map((subtask) => {
              const meta = getStatusMeta(subtask.status, statusCategory?.(subtask.status) ?? null);
              const StatusIcon = meta.Icon;
              const repoLabel = subtask.repositoryFullName?.split("/").pop() ?? null;

              return (
                <button
                  key={subtask.identifier}
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded-md bg-card px-2 py-1 text-left text-xs"
                  onClick={() => onSelectIssue(subtask)}
                >
                  <span className="shrink-0" title={subtask.status}>
                    <StatusIcon className={cn("h-3 w-3", meta.iconClass)} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground">{subtask.title}</span>
                  {repoLabel ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 font-mono text-[9px] text-muted-foreground">
                      <GitFork className="h-2.5 w-2.5" />
                      {repoLabel}
                    </span>
                  ) : null}
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{issueDisplayIdentifier(subtask)}</span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
