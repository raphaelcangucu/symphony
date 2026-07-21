import { ChevronDown, ChevronRight, Loader2, Maximize2, RotateCcw, SquareArrowOutUpRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { TerminalView } from "@/components/terminal/TerminalView";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useFloatingSurfaces } from "@/hooks/useFloatingSurfaces";
import { buildFloatingSurfaceId } from "@/lib/floatingSurfaceIds";
import { cn } from "@/lib/utils";
import {
  fetchDevServerOutput,
  subscribeDevServerOutput,
  type DevServerOutputStreamHandlers,
} from "@/services/issueDevServers";
import {
  fetchThreadDevServerOutput,
  subscribeThreadDevServerOutput,
} from "@/services/threadDevServers";
import { openFloatingSurfaceOrToast } from "@/stores/floatingSurfaceStore";
import type { IssueDevServerStatus } from "@/types/issue";

const STREAM_STATUSES = new Set<IssueDevServerStatus>(["pending", "provisioning", "starting", "stalled"]);
const AUTO_OPEN_STATUSES = new Set<IssueDevServerStatus>(["pending", "provisioning", "starting", "stalled", "crashed"]);
const RERUN_STATUSES = new Set<IssueDevServerStatus>(["crashed", "stopped", "stalled"]);
const READY_POLL_MS = 5_000;

interface DevServerOutputPanelProps {
  projectSlug: string;
  issueIdentifier: string;
  threadId?: number;
  serverId: number;
  slug: string;
  status: IssueDevServerStatus;
  sessionName: string | null;
  defaultOpen?: boolean;
  onRerun?: () => void;
}

export function DevServerOutputPanel({
  projectSlug,
  issueIdentifier,
  threadId,
  serverId,
  slug,
  status,
  sessionName,
  defaultOpen = false,
  onRerun,
}: DevServerOutputPanelProps) {
  const { t } = useTranslation();
  const floatingSurfaces = useFloatingSurfaces();
  const [open, setOpen] = useState(defaultOpen);
  const [fullscreen, setFullscreen] = useState(false);
  const [output, setOutput] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const stickToBottomRef = useRef(true);

  const hasInteractiveSession = threadId == null && Boolean(sessionName?.trim());
  const popoutSurfaceId = useMemo(
    () => {
      if (threadId != null) return "";
      return buildFloatingSurfaceId({
        kind: "dev-server-output",
        projectSlug,
        issueIdentifier,
        serverId,
        serverSlug: slug,
        title: t("issue.devServer.fullscreenTitle", { slug }),
      });
    },
    [issueIdentifier, projectSlug, serverId, slug, t, threadId],
  );
  const popoutOpen = floatingSurfaces.some((surface) => surface.id === popoutSurfaceId);
  const interactiveEnabled = open && !fullscreen && !popoutOpen;

  const applyOutput = useCallback((nextOutput: string) => {
    setOutput(nextOutput);
    setError(null);

    if (stickToBottomRef.current && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!open || hasInteractiveSession) {
      return;
    }

    setLoading(true);

    try {
      const response =
        threadId != null
          ? await fetchThreadDevServerOutput(threadId, serverId)
          : await fetchDevServerOutput(projectSlug, issueIdentifier, serverId);
      applyOutput(response.output);
    } catch {
      setError(t("issue.devServer.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [
    applyOutput,
    hasInteractiveSession,
    issueIdentifier,
    open,
    projectSlug,
    serverId,
    t,
    threadId,
  ]);

  useEffect(() => {
    if (!open || hasInteractiveSession) {
      return undefined;
    }

    if (!STREAM_STATUSES.has(status)) {
      void refresh();

      // A ready server keeps producing logs; keep a light live tail without
      // holding an SSE stream open forever.
      if (status === "ready") {
        const interval = window.setInterval(() => void refresh(), READY_POLL_MS);
        return () => window.clearInterval(interval);
      }

      return undefined;
    }

    setLoading(true);

    const handlers: DevServerOutputStreamHandlers = {
      onSnapshot: (payload) => {
        applyOutput(payload.output);
        setLoading(false);
      },
      onUpdate: (payload) => {
        applyOutput(payload.output);
      },
      onDone: () => {
        setLoading(false);
      },
      onError: () => {
        setLoading(false);
        void refresh();
      },
    };

    const unsubscribe =
      threadId != null
        ? subscribeThreadDevServerOutput(threadId, serverId, handlers)
        : subscribeDevServerOutput(projectSlug, issueIdentifier, serverId, handlers);

    return unsubscribe;
  }, [
    applyOutput,
    hasInteractiveSession,
    issueIdentifier,
    open,
    projectSlug,
    refresh,
    serverId,
    status,
    threadId,
  ]);

  useEffect(() => {
    if (AUTO_OPEN_STATUSES.has(status)) {
      setOpen(true);
    }
  }, [status]);

  const showRerun = onRerun != null && RERUN_STATUSES.has(status);

  const handlePopout = () => {
    openFloatingSurfaceOrToast(
      {
        kind: "dev-server-output",
        projectSlug,
        issueIdentifier,
        serverId,
        serverSlug: slug,
        title: t("issue.devServer.fullscreenTitle", { slug }),
      },
      t("floatingSurface.maxSurfaces"),
    );
  };

  const handleScroll = (event: React.UIEvent<HTMLPreElement>) => {
    const element = event.currentTarget;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    stickToBottomRef.current = nearBottom;
  };

  const outputPre = (ref: React.RefObject<HTMLPreElement | null>, className: string) => (
    <pre
      ref={ref}
      aria-label={t("issue.devServer.outputAria", { slug })}
      className={cn(
        "overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-slate-100",
        className,
        output.trim().length === 0 && "text-slate-500",
      )}
      onScroll={handleScroll}
    >
      {output.trim().length > 0 ? output : t("issue.devServer.empty")}
    </pre>
  );

  const interactiveTerminal = (enabled: boolean, className: string) => (
    <TerminalView
      kind="dev-server"
      projectSlug={projectSlug}
      issueIdentifier={issueIdentifier}
      serverSlug={slug}
      enabled={enabled}
      ariaLabel={t("issue.devServer.interactiveAria", { slug })}
      className={className}
    />
  );

  return (
    <div className="rounded-md border bg-slate-950/80">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-medium text-slate-200"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <span>{t("issue.devServer.commandOutput")}</span>
          {sessionName ? <span className="truncate font-mono text-slate-400">{sessionName}</span> : null}
          {loading ? <Loader2 className="h-3 w-3 animate-spin text-slate-400" /> : null}
        </button>
        {showRerun ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-amber-300 hover:text-amber-200"
            onClick={() => onRerun?.()}
          >
            <RotateCcw className="h-3 w-3" />
            {t("issue.devServer.rerun")}
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setFullscreen(true)}
          aria-label={t("issue.devServer.fullscreenAria", { slug })}
          title={t("issue.devServer.interactiveHint")}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
        {threadId == null ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={handlePopout}
            aria-label={t("issue.devServer.popoutAria", { slug })}
          >
            <SquareArrowOutUpRight className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {!hasInteractiveSession ? (
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void refresh()} disabled={!open}>
            {t("issue.devServer.refresh")}
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="p-2">
          {hasInteractiveSession ? (
            interactiveTerminal(interactiveEnabled, "h-64")
          ) : error ? (
            <p className="text-xs text-red-400">{error}</p>
          ) : (
            outputPre(preRef, "max-h-64")
          )}
        </div>
      ) : null}

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="max-w-[calc(100%-2rem)] bg-slate-950 p-4 sm:max-w-5xl">
          <DialogTitle className="flex items-center gap-2 text-sm text-slate-200">
            <span>{t("issue.devServer.fullscreenTitle", { slug })}</span>
            {sessionName ? <span className="truncate font-mono text-xs text-slate-400">{sessionName}</span> : null}
            {showRerun ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-amber-300 hover:text-amber-200"
                onClick={() => onRerun?.()}
              >
                <RotateCcw className="h-3 w-3" />
                {t("issue.devServer.rerun")}
              </Button>
            ) : null}
          </DialogTitle>
          {hasInteractiveSession ? (
            <>
              <p className="text-xs text-slate-400">{t("issue.devServer.interactiveHint")}</p>
              {interactiveTerminal(fullscreen, "h-[70vh]")}
            </>
          ) : (
            <div className="space-y-2">
              {error ? <p className="text-xs text-red-400">{error}</p> : null}
              {outputPre(preRef, "h-[70vh]")}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
