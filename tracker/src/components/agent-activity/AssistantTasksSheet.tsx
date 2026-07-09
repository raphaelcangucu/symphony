import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AgentTaskItems, completedTaskCount } from "@/components/agent-activity/AgentTaskList";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

interface AssistantTasksSheetProps {
  open: boolean;
  snapshot: AgentTaskSnapshot;
  onOpenChange: (open: boolean) => void;
}

/** Full-width overlay tasks panel for viewports below the `lg` breakpoint. */
export function AssistantTasksSheet({ open, snapshot, onOpenChange }: AssistantTasksSheetProps) {
  const { t } = useTranslation();
  const done = completedTaskCount(snapshot);

  if (snapshot.tasks.length === 0) {
    throw new Error("AssistantTasksSheet requires a non-empty task snapshot");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
        data-testid="assistant-tasks-sheet"
      >
        <SheetHeader className="space-y-1 border-b px-4 py-3 pr-12 text-left">
          <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
            <ListChecks className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {t("issue.tasks.title")}
          </SheetTitle>
          <SheetDescription className="text-[11px] tabular-nums text-muted-foreground">
            {t("issue.tasks.progress", { done, total: snapshot.tasks.length })}
          </SheetDescription>
        </SheetHeader>
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 pb-4", SCROLLBAR_THIN)}>
          <AgentTaskItems snapshot={snapshot} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
