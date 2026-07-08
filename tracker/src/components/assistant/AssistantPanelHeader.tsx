import { Bot } from "lucide-react";

import type { DiffStats } from "@/lib/diffStats";
import { cn } from "@/lib/utils";

interface AssistantPanelHeaderProps {
  title: string;
  isPageMode: boolean;
  projectSlug?: string;
  diffStats: DiffStats | null;
  modelCommand: string | null;
}

export function AssistantPanelHeader({
  title,
  isPageMode,
  projectSlug,
  diffStats,
  modelCommand,
}: AssistantPanelHeaderProps) {
  return (
    <div
      data-testid="project-assistant-compact-header"
      className={cn(
        "border-b bg-background/95",
        isPageMode ? "px-4 py-2 lg:px-6" : "px-4 py-2",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Bot className="h-4 w-4" />
          </span>
          <h2 className="truncate text-sm font-semibold leading-tight">{title}</h2>
          {projectSlug ? (
            <span className="hidden max-w-[18rem] truncate rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline-flex">
              {projectSlug}
            </span>
          ) : null}
          {diffStats ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2 py-0.5 font-mono text-[11px]"
              title={`+${diffStats.additions}/-${diffStats.deletions} lines`}
            >
              <span className="text-emerald-600">+{diffStats.additions}</span>
              <span className="text-rose-600">-{diffStats.deletions}</span>
            </span>
          ) : null}
        </div>
        {modelCommand ? (
          <span className="min-w-0 max-w-full truncate text-[11px] text-muted-foreground sm:max-w-[18rem]">
            {modelCommand}
          </span>
        ) : null}
      </div>
    </div>
  );
}
