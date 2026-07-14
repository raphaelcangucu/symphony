import { GitBranch, GitCommitHorizontal, GitCompare, HardDrive, PanelRight, X } from "lucide-react";
import { type RefObject, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { GitDiffLauncher } from "@/components/issues/issue-detail/git-diff/GitDiffLauncher";
import { Button } from "@/components/ui/button";
import { useHorizontalPanelResize } from "@/hooks/useHorizontalPanelResize";
import { useWorkspaceDiffStats } from "@/hooks/useWorkspaceDiffStats";
import { cn } from "@/lib/utils";
import { issuePath, type WorkspaceView } from "@/lib/workspaceRoutes";

const ENVIRONMENT_DOCK_WIDTH_STORAGE_KEY = "symphony:issue-environment-dock-width";
const ENVIRONMENT_DOCK_DEFAULT_WIDTH = 280;
const ENVIRONMENT_DOCK_MIN_WIDTH = 240;

interface IssueEnvironmentDockProps {
  projectSlug: string;
  issueIdentifier: string;
  view: WorkspaceView;
  branch?: string | null;
  splitContainerRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

export function IssueEnvironmentDock({
  projectSlug,
  issueIdentifier,
  view,
  branch = null,
  splitContainerRef,
  onClose,
}: IssueEnvironmentDockProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [compareRequestId, setCompareRequestId] = useState(0);
  const diffStats = useWorkspaceDiffStats({
    projectSlug,
    issueIdentifier,
    enabled: true,
  });
  const { width, isResizing, onResizePointerDown, onResizePointerUp } = useHorizontalPanelResize({
    containerRef: splitContainerRef,
    storageKey: ENVIRONMENT_DOCK_WIDTH_STORAGE_KEY,
    defaultWidth: ENVIRONMENT_DOCK_DEFAULT_WIDTH,
    minWidth: ENVIRONMENT_DOCK_MIN_WIDTH,
  });

  const openCompare = useCallback(() => {
    setCompareRequestId((current) => current + 1);
  }, []);

  const openCommitPush = useCallback(() => {
    navigate(issuePath(projectSlug, view, issueIdentifier, "sessions"));
  }, [navigate, projectSlug, view, issueIdentifier]);

  const additions = diffStats?.additions ?? 0;
  const deletions = diffStats?.deletions ?? 0;

  return (
    <aside
      data-testid="environment-dock"
      className={cn(
        "relative flex min-h-0 shrink-0 flex-col overflow-hidden pl-1.5",
        isResizing && "select-none",
      )}
      style={{ width: `${width}px`, maxWidth: "75%" }}
    >
      <button
        type="button"
        aria-label={t("workspace.environment.resizeHandleAria")}
        title={t("workspace.environment.resizeHandleAria")}
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <PanelRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{t("assistant.environment.title")}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            aria-label={t("workspace.environment.closeDock")}
            title={t("workspace.environment.closeDock")}
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{t("assistant.environment.changes")}</span>
            <span className="flex items-center gap-1.5 font-mono">
              <span className="font-semibold text-emerald-500">+{additions}</span>
              <span className="font-semibold text-rose-500">−{deletions}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <HardDrive className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t("assistant.environment.local")}</span>
          </div>

          {branch ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate font-mono" title={branch}>
                {branch}
              </span>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-start gap-2"
              aria-label={t("assistant.environment.commitPush")}
              onClick={openCommitPush}
            >
              <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t("assistant.environment.commitPush")}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-start gap-2"
              aria-label={t("assistant.environment.compare")}
              onClick={openCompare}
            >
              <GitCompare className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t("assistant.environment.compare")}</span>
            </Button>
          </div>

          <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("assistant.environment.sources")}
            </p>
            <p className="truncate text-xs" title={projectSlug}>
              {projectSlug}
            </p>
          </div>
        </div>
      </div>

      <GitDiffLauncher
        projectSlug={projectSlug}
        identifier={issueIdentifier}
        openRequestId={compareRequestId}
        showTrigger={false}
      />
    </aside>
  );
}

export { ENVIRONMENT_DOCK_WIDTH_STORAGE_KEY };
