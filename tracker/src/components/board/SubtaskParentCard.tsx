import { ChevronDown, ChevronRight, GitFork, Layers } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

import { IssueCard } from "./IssueCard";

interface SubtaskParentCardProps {
  issue: Issue;
  subtasks: Issue[];
  onSelectIssue: (issue: Issue) => void;
  agent?: AgentExecution;
  mergeActive?: boolean;
  dropEdge?: "top" | "bottom" | null;
}

export function SubtaskParentCard({
  issue,
  subtasks,
  onSelectIssue,
  agent,
  mergeActive = false,
  dropEdge = null,
}: SubtaskParentCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const summary = issue.subIssueSummary;
  const count = summary?.total ?? subtasks.length;

  return (
    <div className="space-y-1">
      <IssueCard issue={issue} onSelect={onSelectIssue} agent={agent} mergeActive={mergeActive} dropEdge={dropEdge} />

      {count > 0 ? (
        <div className="rounded-lg border border-border/60 bg-muted/30 px-1.5 py-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((value) => !value);
            }}
            className="inline-flex w-full items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
            title={expanded ? t("board.subtasks.collapse") : t("board.subtasks.expand")}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Layers className="h-3 w-3" />
            {t("board.subtasks.count", { count })}
            {summary ? (
              <span className="ml-auto font-mono">
                {summary.completed} / {summary.total}
              </span>
            ) : null}
          </button>

          {expanded ? (
            <div className="mt-1 space-y-1 border-l-2 border-border/60 pl-2">
              {subtasks.length === 0 ? (
                <p className="px-2 py-1 text-[10px] text-muted-foreground">{t("board.subtasks.empty")}</p>
              ) : (
                subtasks.map((subtask) => (
                  <button
                    key={subtask.identifier}
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded-md bg-card px-2 py-1 text-left text-xs"
                    onClick={() => onSelectIssue(subtask)}
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">{subtask.identifier}</span>
                    <span className="min-w-0 flex-1 truncate">{subtask.title}</span>
                    {subtask.repositoryFullName ? (
                      <span className="inline-flex items-center gap-0.5 font-mono text-[9px] text-muted-foreground">
                        <GitFork className="h-2.5 w-2.5" />
                        {subtask.repositoryFullName.split("/").pop()}
                      </span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
