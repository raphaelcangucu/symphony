import { ListChecks, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AgentTaskItems, completedTaskCount } from "@/components/agent-activity/AgentTaskList";
import { Button } from "@/components/ui/button";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

interface AssistantTasksDockProps {
  snapshot: AgentTaskSnapshot;
  onClose: () => void;
}

export function AssistantTasksDock({ snapshot, onClose }: AssistantTasksDockProps) {
  const { t } = useTranslation();
  const done = completedTaskCount(snapshot);

  return (
    <aside
      data-testid="assistant-tasks-dock"
      aria-label={t("issue.tasks.title")}
      className="flex h-full w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm lg:w-80"
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <ListChecks className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{t("issue.tasks.title")}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {t("issue.tasks.progress", { done, total: snapshot.tasks.length })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            aria-label={t("issue.tasks.close")}
            title={t("issue.tasks.close")}
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-3 pb-3", SCROLLBAR_THIN)}>
        <AgentTaskItems snapshot={snapshot} />
      </div>
    </aside>
  );
}
