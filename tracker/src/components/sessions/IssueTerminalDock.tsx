import { Maximize2, Minimize2, X } from "lucide-react";
import { type RefObject, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { TerminalWorkspacePanel } from "@/components/terminal/TerminalWorkspacePanel";
import { Button } from "@/components/ui/button";
import { useHorizontalPanelResize } from "@/hooks/useHorizontalPanelResize";
import { cn } from "@/lib/utils";

const TERMINAL_DOCK_WIDTH_STORAGE_KEY = "symphony:issue-terminal-dock-width";

interface IssueTerminalDockProps {
  projectSlug: string;
  issueIdentifier: string;
  splitContainerRef: RefObject<HTMLDivElement | null>;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
}

export function IssueTerminalDock({
  projectSlug,
  issueIdentifier,
  splitContainerRef,
  fullscreen,
  onToggleFullscreen,
  onClose,
}: IssueTerminalDockProps) {
  const { t } = useTranslation();
  const { width, isResizing, onResizePointerDown, onResizePointerUp } = useHorizontalPanelResize({
    containerRef: splitContainerRef,
    storageKey: TERMINAL_DOCK_WIDTH_STORAGE_KEY,
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
    ? t("workspace.terminal.exitFullscreen")
    : t("workspace.terminal.expandFullscreen");

  return (
    <aside
      data-testid="terminal-dock"
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
          aria-label={t("workspace.terminal.resizeHandleAria")}
          title={t("workspace.terminal.resizeHandleAria")}
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TerminalWorkspacePanel
          key={`${projectSlug}:${issueIdentifier}`}
          projectSlug={projectSlug}
          issueIdentifier={issueIdentifier}
          variant="embedded"
          trailingActions={
            <>
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
                aria-label={t("workspace.terminal.closeDock")}
                title={t("workspace.terminal.closeDock")}
                onClick={onClose}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          }
        />
      </div>
    </aside>
  );
}

export { TERMINAL_DOCK_WIDTH_STORAGE_KEY };
