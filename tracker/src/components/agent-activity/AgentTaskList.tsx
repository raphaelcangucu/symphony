import { CheckCircle2, ChevronDown, ChevronRight, Circle, ListChecks, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { AgentTask, AgentTaskSnapshot, AgentTaskStatus } from "@/types/agentTasks";

const STORAGE_KEY = "symphony.agentTasks.collapsed";

interface AgentTaskListProps {
  snapshot: AgentTaskSnapshot;
}

function statusIcon(status: AgentTaskStatus) {
  if (status === "completed") return <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-hidden />;
  if (status === "in_progress") return <Loader2 className="size-4 shrink-0 animate-spin text-amber-500" aria-hidden />;
  return <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

export function completedTaskCount(snapshot: AgentTaskSnapshot): number {
  return snapshot.tasks.filter((task) => task.status === "completed").length;
}

interface AgentTaskItemsProps {
  snapshot: AgentTaskSnapshot;
}

export function AgentTaskItems({ snapshot }: AgentTaskItemsProps) {
  const { t } = useTranslation();

  return (
    <>
      {snapshot.explanation ? <p className="mt-2 text-xs text-muted-foreground">{snapshot.explanation}</p> : null}
      <ul className="mt-2 space-y-1">
        {snapshot.tasks.map((task: AgentTask) => (
          <li
            key={task.id}
            data-status={task.status}
            className="flex items-center gap-2 text-sm"
            title={t(`issue.tasks.status.${task.status}`)}
          >
            {statusIcon(task.status)}
            <span className={cn(task.status === "completed" && "text-muted-foreground line-through")}>
              {task.text}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function AgentTaskList({ snapshot }: AgentTaskListProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<boolean>(() => window.localStorage.getItem(STORAGE_KEY) === "true");

  const done = completedTaskCount(snapshot);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  return (
    <section className="mb-3 rounded-lg border bg-muted/30 p-3" aria-label={t("issue.tasks.title")}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? t("issue.tasks.expand") : t("issue.tasks.collapse")}
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {collapsed ? (
            <ChevronRight className="size-3.5" aria-hidden />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden />
          )}
          <ListChecks className="size-3.5" aria-hidden />
          {t("issue.tasks.title")}
        </button>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {t("issue.tasks.progress", { done, total: snapshot.tasks.length })}
        </span>
      </div>
      {collapsed ? null : <AgentTaskItems snapshot={snapshot} />}
    </section>
  );
}
