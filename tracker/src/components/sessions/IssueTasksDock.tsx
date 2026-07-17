import { ListChecks, Maximize2, Minimize2, Wrench, X } from "lucide-react";
import { type RefObject, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { AgentTaskItems, completedTaskCount } from "@/components/agent-activity/AgentTaskList";
import { ToolActivityTimeline } from "@/components/agent-activity/ToolActivityTimeline";
import { useSessionTasksDockFeed } from "@/components/sessions/sessionTasksDockFeedContext";
import { Button } from "@/components/ui/button";
import { useHorizontalPanelResize } from "@/hooks/useHorizontalPanelResize";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";

const TASKS_DOCK_WIDTH_STORAGE_KEY = "symphony:issue-tasks-dock-width";
const TASKS_DOCK_DEFAULT_WIDTH = 320;
const TASKS_DOCK_MIN_WIDTH = 280;

interface IssueTasksDockProps {
  issueIdentifier: string;
  splitContainerRef: RefObject<HTMLDivElement | null>;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
}

export function IssueTasksDock({
  issueIdentifier,
  splitContainerRef,
  fullscreen,
  onToggleFullscreen,
  onClose,
}: IssueTasksDockProps) {
  const { t } = useTranslation();
  const { tasks, toolItems } = useSessionTasksDockFeed();
  const { width, isResizing, onResizePointerDown, onResizePointerUp } = useHorizontalPanelResize({
    containerRef: splitContainerRef,
    storageKey: TASKS_DOCK_WIDTH_STORAGE_KEY,
    defaultWidth: TASKS_DOCK_DEFAULT_WIDTH,
    minWidth: TASKS_DOCK_MIN_WIDTH,
    enabled: !fullscreen,
  });

  useEffect(() => {
    if (!fullscreen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onToggleFullscreen();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fullscreen, onToggleFullscreen]);

  const fullscreenLabel = fullscreen
    ? t("workspace.tasks.exitFullscreen")
    : t("workspace.tasks.expandFullscreen");
  const done = tasks ? completedTaskCount(tasks) : 0;
  const total = tasks?.tasks.length ?? 0;

  return (
    <aside
      data-testid="tasks-dock"
      aria-label={t("workspace.tasks.ariaLabel", { identifier: issueIdentifier })}
      className={cn(
        "relative flex min-h-0 flex-col overflow-hidden",
        fullscreen ? "min-w-0 flex-1" : "shrink-0 pl-1.5",
        isResizing && "select-none",
      )}
      style={fullscreen ? undefined : { width: `${width}px`, maxWidth: "75%" }}
    >
      {!fullscreen ? (
        <button
          type="button"
          aria-label={t("workspace.tasks.resizeHandleAria")}
          title={t("workspace.tasks.resizeHandleAria")}
          className="group absolute inset-y-0 left-0 z-10 flex w-3 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none"
          onPointerDown={onResizePointerDown}
          onPointerUp={onResizePointerUp}
        >
          <span
            aria-hidden
            className={cn(
              "h-full w-[3px] rounded-full transition-colors",
              isResizing ? "bg-primary/60" : "bg-transparent group-hover:bg-primary/40 group-focus-visible:bg-primary/40",
            )}
          />
        </button>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-sm font-medium">{t("workspace.tasks.title")}</span>
            {total > 0 ? (
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {t("issue.tasks.progress", { done, total })}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label={fullscreenLabel}
              title={fullscreenLabel}
              onClick={onToggleFullscreen}
            >
              {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label={t("workspace.tasks.closeDock")}
              title={t("workspace.tasks.closeDock")}
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </header>

        <div className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3", SCROLLBAR_THIN)}>
          <section aria-label={t("workspace.tasks.tasksSection")}>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <ListChecks className="size-3.5 shrink-0" aria-hidden />
              <span>{t("workspace.tasks.tasksSection")}</span>
            </div>
            {tasks && tasks.tasks.length > 0 ? (
              <AgentTaskItems snapshot={tasks} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("workspace.tasks.emptyTasks")}</p>
            )}
          </section>

          <section aria-label={t("workspace.tasks.toolsSection")}>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Wrench className="size-3.5 shrink-0" aria-hidden />
              <span>{t("workspace.tasks.toolsSection")}</span>
            </div>
            {toolItems.length > 0 ? (
              <ToolActivityTimeline toolCalls={[...toolItems]} taskSnapshot={tasks} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("workspace.tasks.emptyTools")}</p>
            )}
          </section>
        </div>
      </div>
    </aside>
  );
}

export { TASKS_DOCK_WIDTH_STORAGE_KEY };
