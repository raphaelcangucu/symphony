import {
  AppWindow,
  Maximize2,
  Minimize2,
  SquareArrowOutUpRight,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { PreviewPanel } from "@/components/issues/issue-detail/PreviewTab";
import { MinibrowserChrome } from "@/components/sessions/MinibrowserChrome";
import { Button } from "@/components/ui/button";
import { useHorizontalPanelResize } from "@/hooks/useHorizontalPanelResize";
import { useIssueDevServers } from "@/hooks/useIssueDevServers";
import { useThreadDevServers } from "@/hooks/useThreadDevServers";
import { openablePreviewUrl, selectPrimaryServer } from "@/lib/devServerUrls";
import { cn } from "@/lib/utils";
import type { WorkspaceView } from "@/lib/workspaceRoutes";
import { workspaceScopeLabel, type WorkspaceScope } from "@/lib/workspaceScope";
import { openFloatingSurfaceOrToast } from "@/stores/floatingSurfaceStore";
import type { AgentExecution } from "@/types/agent-execution";
import type { IssueDevServerStatus } from "@/types/issue";

const PREVIEW_DOCK_WIDTH_STORAGE_KEY = "symphony:issue-preview-dock-width";

const STATUS_DOT_CLASS: Record<IssueDevServerStatus, string> = {
  crashed: "bg-red-500",
  pending: "bg-slate-400",
  provisioning: "bg-blue-500",
  ready: "bg-emerald-500",
  starting: "bg-blue-500",
  stalled: "bg-amber-500",
  stopped: "bg-muted-foreground/40",
};

interface IssuePreviewDockProps {
  scope: WorkspaceScope;
  view: WorkspaceView;
  execution?: AgentExecution;
  splitContainerRef: RefObject<HTMLDivElement | null>;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
}

export function IssuePreviewDock({
  scope,
  view,
  execution,
  splitContainerRef,
  fullscreen,
  onToggleFullscreen,
  onClose,
}: IssuePreviewDockProps) {
  const { t } = useTranslation();
  const projectSlug = scope.projectSlug;
  const issueIdentifier = scope.kind === "issue" ? scope.issueIdentifier : workspaceScopeLabel(scope);
  const issueDevServers = useIssueDevServers(
    scope.kind === "issue" ? projectSlug : null,
    scope.kind === "issue" ? scope.issueIdentifier : null,
  );
  const threadDevServers = useThreadDevServers(scope.kind === "thread" ? scope.threadId : null);
  const devServers = scope.kind === "thread" ? threadDevServers : issueDevServers;
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { width, isResizing, onResizePointerDown, onResizePointerUp } = useHorizontalPanelResize({
    containerRef: splitContainerRef,
    storageKey: PREVIEW_DOCK_WIDTH_STORAGE_KEY,
    enabled: !fullscreen,
  });

  useEffect(() => {
    if (!fullscreen) return;

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onToggleFullscreen();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fullscreen, onToggleFullscreen]);

  const servers = devServers.data?.servers ?? [];
  const selectedServer = servers.find((server) => server.id === selectedServerId) ?? selectPrimaryServer(servers);
  const tunnelRunning = devServers.data?.tunnel?.running ?? false;
  const serverPreviewUrl = openablePreviewUrl(selectedServer, tunnelRunning);
  // Without a ready URL the iframe has nothing to show, so the management panel
  // (with start/restart, logs and assistant handoff) takes over automatically.
  const showDetails = detailsOpen || !serverPreviewUrl;
  const previewUrl = serverPreviewUrl;

  const fullscreenLabel = fullscreen
    ? t("workspace.preview.exitFullscreen")
    : t("workspace.preview.expandFullscreen");
  const detailsLabel = detailsOpen ? t("workspace.preview.hideDetails") : t("workspace.preview.showDetails");

  return (
    <aside
      data-testid="preview-dock"
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
          aria-label={t("workspace.preview.resizeHandleAria")}
          title={t("workspace.preview.resizeHandleAria")}
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
            <AppWindow className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-sm font-medium">{t("workspace.preview.title")}</span>
            {servers.length > 0 ? (
              <div className="flex min-w-0 items-center gap-1 overflow-x-auto" role="tablist" aria-label={t("workspace.preview.serverTabsAria")}>
                {servers.map((server) => {
                  const active = selectedServer?.id === server.id;
                  return (
                    <button
                      key={server.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-label={t("workspace.preview.serverTabAria", { slug: server.slug, status: server.status })}
                      title={`${server.slug} — ${server.status}`}
                      onClick={() => setSelectedServerId(server.id)}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                        active
                          ? "border-border bg-accent text-foreground"
                          : "border-border/60 text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                    >
                      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT_CLASS[server.status])} />
                      <span className="max-w-[8rem] truncate">{server.slug}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 text-muted-foreground hover:text-foreground",
                detailsOpen && "bg-accent text-foreground",
              )}
              aria-label={detailsLabel}
              aria-pressed={detailsOpen}
              title={detailsLabel}
              onClick={() => setDetailsOpen((current) => !current)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </Button>
            {previewUrl && selectedServer && scope.kind === "issue" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                aria-label={t("floatingSurface.popout")}
                title={t("floatingSurface.popout")}
                onClick={() =>
                  openFloatingSurfaceOrToast(
                    {
                      kind: "minibrowser",
                      projectSlug,
                      issueIdentifier,
                      serverId: selectedServer.id,
                      homeUrl: previewUrl,
                      title: `${t("workspace.preview.title")} · ${selectedServer.slug}`,
                    },
                    t("floatingSurface.maxSurfaces"),
                  )
                }
              >
                <SquareArrowOutUpRight className="h-3.5 w-3.5" />
              </Button>
            ) : null}
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
              aria-label={t("workspace.preview.closeDock")}
              title={t("workspace.preview.closeDock")}
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </header>
        {showDetails ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <PreviewPanel
              projectSlug={projectSlug}
              issueIdentifier={issueIdentifier}
              threadId={scope.kind === "thread" ? scope.threadId : undefined}
              issueScoped={scope.kind === "issue"}
              view={view}
              execution={execution}
              devServers={devServers}
            />
          </div>
        ) : previewUrl ? (
          <MinibrowserChrome
            homeUrl={previewUrl}
            frameTitle={t("workspace.preview.frameTitle", { identifier: issueIdentifier })}
          />
        ) : null}
      </div>
    </aside>
  );
}

export { PREVIEW_DOCK_WIDTH_STORAGE_KEY };
