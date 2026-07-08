import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

export interface AssistantTasksDockControl {
  done: number;
  total: number;
  open: boolean;
  toggle: () => void;
}

interface AssistantTasksToolbarToggleProps {
  control: AssistantTasksDockControl | null;
  className?: string;
}

export function AssistantTasksToolbarToggle({ control, className }: AssistantTasksToolbarToggleProps) {
  const { t } = useTranslation();

  if (!control) return null;

  const { done, total, open, toggle } = control;

  return (
    <button
      type="button"
      data-testid="assistant-tasks-toolbar-toggle"
      aria-pressed={open}
      aria-label={open ? t("issue.tasks.hide") : t("issue.tasks.show")}
      title={open ? t("issue.tasks.hide") : t("issue.tasks.show")}
      onClick={toggle}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        open && "bg-accent text-foreground",
        className,
      )}
    >
      <ListChecks className="h-4 w-4 shrink-0" aria-hidden />
      <span className="text-[11px] tabular-nums">{t("issue.tasks.progress", { done, total })}</span>
    </button>
  );
}
