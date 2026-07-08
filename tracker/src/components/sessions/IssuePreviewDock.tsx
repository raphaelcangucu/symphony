import {
  AppWindow,
  ExternalLink,
  Loader2,
  Maximize2,
  Minimize2,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useHorizontalPanelResize } from "@/hooks/useHorizontalPanelResize";
import { useIssueDevServers } from "@/hooks/useIssueDevServers";
import { openablePreviewUrl, selectPrimaryServer } from "@/lib/devServerUrls";
import { cn } from "@/lib/utils";
import type { IssueDevServer, IssueDevServerStatus } from "@/types/issue";

const PREVIEW_DOCK_WIDTH_STORAGE_KEY = "symphony:issue-preview-dock-width";

const PROVISIONING_STATUSES = new Set<IssueDevServerStatus>(["pending", "provisioning", "starting"]);

const STATUS_BADGE_CLASS: Record<IssueDevServerStatus, string> = {
  crashed: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  pending: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  provisioning: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  ready: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  starting: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  stopped: "border-muted bg-muted text-muted-foreground",
};

interface IssuePreviewDockProps {
  projectSlug: string;
  issueIdentifier: string;
  splitContainerRef: RefObject<HTMLDivElement | null>;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
}

export function IssuePreviewDock({
  projectSlug,
  issueIdentifier,
  splitContainerRef,
  fullscreen,
  onToggleFullscreen,
  onClose,
}: IssuePreviewDockProps) {
  const { t } = useTranslation();
  const { data, error, loading, restart, start, stop } = useIssueDevServers(projectSlug, issueIdentifier);
  // Bumping the key forces the iframe to reload with the same URL.
  const [reloadKey, setReloadKey] = useState(0);
  const { width, isResizing, onResizePointerDown, onResizePointerUp } = useHorizontalPanelResize({
    containerRef: splitContainerRef,
    storageKey: PREVIEW_DOCK_WIDTH_STORAGE_KEY,
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

  const primaryServer = selectPrimaryServer(data?.servers ?? []);
  const tunnelRunning = data?.tunnel?.running ?? false;
  const previewUrl = openablePreviewUrl(primaryServer, tunnelRunning);
  const fullscreenLabel = fullscreen
    ? t("workspace.preview.exitFullscreen")
    : t("workspace.preview.expandFullscreen");

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
            <span className="truncate text-sm font-medium">{t("workspace.preview.title")}</span>
            {primaryServer ? (
              <Badge className={cn("capitalize", STATUS_BADGE_CLASS[primaryServer.status])}>
                {primaryServer.status}
              </Badge>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <ServerActions
              disabled={loading}
              running={primaryServer?.status === "ready"}
              onStart={() => void start()}
              onStop={() => void stop()}
              onRestart={() => void restart()}
            />
            {previewUrl ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  aria-label={t("workspace.preview.reload")}
                  title={t("workspace.preview.reload")}
                  onClick={() => setReloadKey((current) => current + 1)}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                >
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={t("workspace.preview.openInNewTab")}
                    title={t("workspace.preview.openInNewTab")}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
              </>
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
        {previewUrl ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
            <iframe
              key={`${previewUrl}:${reloadKey}`}
              src={previewUrl}
              title={t("workspace.preview.frameTitle", { identifier: issueIdentifier })}
              className="h-full w-full flex-1 border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
          </div>
        ) : (
          <PreviewEmptyState
            error={error}
            loading={loading}
            server={primaryServer}
            available={data?.available ?? false}
            hasData={data != null}
            onStart={() => void start()}
          />
        )}
        {previewUrl ? (
          <footer className="flex shrink-0 items-center border-t border-border/50 px-3 py-1">
            <span className="truncate font-mono text-[10px] text-muted-foreground" title={previewUrl}>
              {previewUrl}
            </span>
          </footer>
        ) : null}
      </div>
    </aside>
  );
}

function ServerActions({
  disabled,
  running,
  onStart,
  onStop,
  onRestart,
}: {
  disabled: boolean;
  running: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
}) {
  const { t } = useTranslation();

  if (running) {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          aria-label={t("workspace.preview.restartServer")}
          title={t("workspace.preview.restartServer")}
          disabled={disabled}
          onClick={onRestart}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          aria-label={t("workspace.preview.stopServer")}
          title={t("workspace.preview.stopServer")}
          disabled={disabled}
          onClick={onStop}
        >
          <Square className="h-3.5 w-3.5" />
        </Button>
      </>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7 text-muted-foreground hover:text-foreground"
      aria-label={t("workspace.preview.startServer")}
      title={t("workspace.preview.startServer")}
      disabled={disabled}
      onClick={onStart}
    >
      <Play className="h-3.5 w-3.5" />
    </Button>
  );
}

function PreviewEmptyState({
  error,
  loading,
  server,
  available,
  hasData,
  onStart,
}: {
  error: string | null;
  loading: boolean;
  server: IssueDevServer | null;
  available: boolean;
  hasData: boolean;
  onStart: () => void;
}) {
  const { t } = useTranslation();

  if (loading && !hasData) {
    return (
      <EmptyStateShell icon={<Loader2 className="h-5 w-5 animate-spin" />}>
        {t("workspace.preview.loading")}
      </EmptyStateShell>
    );
  }

  if (error && !hasData) {
    return <EmptyStateShell tone="error">{error}</EmptyStateShell>;
  }

  if (server && PROVISIONING_STATUSES.has(server.status)) {
    return (
      <EmptyStateShell icon={<Loader2 className="h-5 w-5 animate-spin" />}>
        {t("workspace.preview.provisioning", { slug: server.slug, status: server.status })}
      </EmptyStateShell>
    );
  }

  if (server && server.status === "crashed") {
    return <EmptyStateShell tone="error">{t("workspace.preview.crashed", { slug: server.slug })}</EmptyStateShell>;
  }

  if (!available) {
    return <EmptyStateShell>{t("workspace.preview.unavailable")}</EmptyStateShell>;
  }

  return (
    <EmptyStateShell>
      <div className="flex flex-col items-center gap-3">
        <p>{t("workspace.preview.notRunning")}</p>
        <Button type="button" size="sm" onClick={onStart}>
          <Play className="h-3.5 w-3.5" />
          {t("workspace.preview.startServer")}
        </Button>
      </div>
    </EmptyStateShell>
  );
}

function EmptyStateShell({
  children,
  icon,
  tone = "default",
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "default" | "error";
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm",
        tone === "error" ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
      )}
    >
      {icon}
      <div>{children}</div>
    </div>
  );
}

export { PREVIEW_DOCK_WIDTH_STORAGE_KEY };
