import { CheckCircle2, Circle, ListChecks, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  ActivityDisclosure,
  type ActivityDisclosureStateProps,
} from "@/components/agent-activity/ActivityDisclosure";
import { taskToolLabel } from "@/lib/agentTasks";
import { cn } from "@/lib/utils";
import type { AgentTaskSnapshot, AgentTaskStatus } from "@/types/agentTasks";

interface AgentTaskInlineCardProps extends ActivityDisclosureStateProps {
  snapshot: AgentTaskSnapshot;
}

function statusIcon(status: AgentTaskStatus) {
  if (status === "completed") return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" aria-hidden />;
  if (status === "in_progress") return <Loader2 className="size-3.5 shrink-0 animate-spin text-amber-500" aria-hidden />;
  return <Circle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}

export function AgentTaskInlineCard({
  snapshot,
  expanded,
  onExpandedChange,
}: AgentTaskInlineCardProps) {
  const { t } = useTranslation();
  const done = snapshot.tasks.filter((task) => task.status === "completed").length;
  const running = snapshot.tasks.some((task) => task.status === "in_progress");
  const label = taskToolLabel(snapshot.source);

  return (
    <ActivityDisclosure
      icon={
        running ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ListChecks className="size-3.5" />
        )
      }
      label={t("issue.tasks.inline", { label, done, total: snapshot.tasks.length })}
      status={running ? "running" : null}
      statusLabel={running ? t("issue.tasks.status.in_progress") : undefined}
      details={
        snapshot.tasks.length > 0 ? (
          <ul className="space-y-1 text-xs">
            {snapshot.tasks.map((task) => (
              <li key={task.id} data-status={task.status} className="flex items-center gap-2">
                {statusIcon(task.status)}
                <span className={cn(task.status === "completed" && "text-muted-foreground line-through")}>
                  {task.text}
                </span>
              </li>
            ))}
          </ul>
        ) : null
      }
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    />
  );
}
