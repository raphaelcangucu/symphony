import { CheckCircle2, Circle, ListChecks, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { taskToolLabel } from "@/lib/agentTasks";
import { cn } from "@/lib/utils";
import type { AgentTaskSnapshot, AgentTaskStatus } from "@/types/agentTasks";

interface AgentTaskInlineCardProps {
  snapshot: AgentTaskSnapshot;
}

function statusIcon(status: AgentTaskStatus) {
  if (status === "completed") return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" aria-hidden />;
  if (status === "in_progress") return <Loader2 className="size-3.5 shrink-0 animate-spin text-amber-500" aria-hidden />;
  return <Circle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}

export function AgentTaskInlineCard({ snapshot }: AgentTaskInlineCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const done = snapshot.tasks.filter((task) => task.status === "completed").length;
  const label = taskToolLabel(snapshot.source);

  return (
    <div className="rounded-lg border border-dashed bg-background/60 p-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 font-medium text-muted-foreground"
      >
        <ListChecks className="size-3.5" aria-hidden />
        {t("issue.tasks.inline", { label, done, total: snapshot.tasks.length })}
      </button>
      {open ? (
        <ul className="mt-2 space-y-1">
          {snapshot.tasks.map((task) => (
            <li key={task.id} data-status={task.status} className="flex items-center gap-2">
              {statusIcon(task.status)}
              <span className={cn(task.status === "completed" && "text-muted-foreground line-through")}>
                {task.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
