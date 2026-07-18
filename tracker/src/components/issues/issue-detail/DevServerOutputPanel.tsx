import { ChevronDown, ChevronRight, Keyboard, Loader2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { TerminalView } from "@/components/terminal/TerminalView";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fetchDevServerOutput, subscribeDevServerOutput } from "@/services/issueDevServers";
import type { IssueDevServerStatus } from "@/types/issue";
import { cn } from "@/lib/utils";

const STREAM_STATUSES = new Set<IssueDevServerStatus>(["pending", "provisioning", "starting", "stalled"]);
const AUTO_OPEN_STATUSES = new Set<IssueDevServerStatus>(["pending", "provisioning", "starting", "stalled", "crashed"]);
const RERUN_STATUSES = new Set<IssueDevServerStatus>(["crashed", "stopped", "stalled"]);
const READY_POLL_MS = 5_000;

interface DevServerOutputPanelProps {
  projectSlug: string;
  issueIdentifier: string;
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
  serverId,
  slug,
  status,
  sessionName,
  defaultOpen = false,
  onRerun,
}: DevServerOutputPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const [fullscreen, setFullscreen] = useState(false);
  const [output, setOutput] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const stickToBottomRef = useRef(true);

  const applyOutput = useCallback((nextOutput: string) => {
    setOutput(nextOutput);
    setError(null);

    if (stickToBottomRef.current && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!open) {
      return;
    }

    setLoading(true);

    try {
      const response = await fetchDevServerOutput(projectSlug, issueIdentifier, serverId);
      applyOutput(response.output);
    } catch {
      setError(t("issue.devServer.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [applyOutput, issueIdentifier, open, projectSlug, serverId, t]);

  useEffect(() => {
    if (!open) {
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

    const unsubscribe = subscribeDevServerOutput(projectSlug, issueIdentifier, serverId, {
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
    });

    return unsubscribe;
  }, [applyOutput, issueIdentifier, open, projectSlug, refresh, serverId, status]);

  useEffect(() => {
    if (AUTO_OPEN_STATUSES.has(status)) {
      setOpen(true);
    }
  }, [status]);

  const showRerun = onRerun != null && RERUN_STATUSES.has(status);

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
          <Keyboard className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void refresh()} disabled={!open}>
          {t("issue.devServer.refresh")}
        </Button>
      </div>

      {open ? (
        <div className="p-2">
          {error ? <p className="text-xs text-red-400">{error}</p> : outputPre(preRef, "max-h-64")}
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
          <p className="text-xs text-slate-400">{t("issue.devServer.interactiveHint")}</p>
          <TerminalView
            kind="dev-server"
            projectSlug={projectSlug}
            issueIdentifier={issueIdentifier}
            serverSlug={slug}
            enabled={fullscreen}
            ariaLabel={t("issue.devServer.interactiveAria", { slug })}
            className="h-[70vh]"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
