import { ChevronDown, ChevronRight, GitFork, ListTree } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { getStatusMeta, isCompletedStatus } from "@/components/board/status-meta";
import { cn } from "@/lib/utils";
import type { Issue } from "@/types/issue";

interface SubIssueSummary {
  total: number;
  completed: number;
  percentCompleted: number;
}

interface SubIssuesSectionProps {
  subtasks: Issue[];
  summary?: SubIssueSummary | null;
  onOpenIssue?: (identifier: string) => void;
}

/**
 * GitHub-style "Sub-issues" block for the issue detail view. Mirrors the parent
 * card on the board but laid out for the summary tab: a collapsible header with
 * a "completed / total" badge over a list of child issues. The `summary` (from
 * GitHub's subIssuesSummary) is the source of truth for the count so the header
 * stays correct even when some children are missing from the loaded board list.
 */
export function SubIssuesSection({ subtasks, summary = null, onOpenIssue }: SubIssuesSectionProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  const total = summary?.total ?? subtasks.length;
  if (total === 0) {
    return null;
  }

  const completed = summary?.completed ?? subtasks.filter((subtask) => isCompletedStatus(subtask.status)).length;

  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={expanded}
        title={expanded ? t("issue.summary.subIssues.collapse") : t("issue.summary.subIssues.expand")}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <ListTree className="h-3.5 w-3.5" />
        {t("issue.summary.subIssues.title")}
        <span className="ml-1 rounded-full border border-border/60 px-1.5 py-0.5 font-mono text-[10px] normal-case tracking-normal text-muted-foreground">
          {t("issue.summary.subIssues.progress", { completed, total })}
        </span>
      </button>

      {expanded ? (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card">
          {subtasks.length === 0 ? (
            <li className="px-3 py-2.5 text-xs text-muted-foreground">{t("issue.summary.subIssues.empty")}</li>
          ) : (
            subtasks.map((subtask) => {
              const meta = getStatusMeta(subtask.status);
              const StatusIcon = meta.Icon;
              const repoLabel = subtask.repositoryFullName?.split("/").pop() ?? null;

              return (
                <li key={subtask.identifier}>
                  <button
                    type="button"
                    onClick={() => onOpenIssue?.(subtask.identifier)}
                    disabled={!onOpenIssue}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                      onOpenIssue ? "hover:bg-accent" : "cursor-default",
                    )}
                  >
                    <span className="shrink-0" title={subtask.status}>
                      <StatusIcon className={cn("h-4 w-4", meta.iconClass)} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground">{subtask.title}</span>
                    {repoLabel ? (
                      <span className="inline-flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-muted-foreground">
                        <GitFork className="h-3 w-3" />
                        {repoLabel}
                      </span>
                    ) : null}
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{subtask.identifier}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </section>
  );
}
