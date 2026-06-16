import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { fetchDevServerOutput, subscribeDevServerOutput } from "@/services/issueDevServers";
import type { IssueDevServerStatus } from "@/types/issue";
import { cn } from "@/lib/utils";

const STREAM_STATUSES = new Set<IssueDevServerStatus>(["pending", "provisioning", "starting"]);
const AUTO_OPEN_STATUSES = new Set<IssueDevServerStatus>(["pending", "provisioning", "starting", "crashed"]);

interface DevServerOutputPanelProps {
  projectSlug: string;
  issueIdentifier: string;
  serverId: number;
  slug: string;
  status: IssueDevServerStatus;
  sessionName: string | null;
  defaultOpen?: boolean;
}

export function DevServerOutputPanel({
  projectSlug,
  issueIdentifier,
  serverId,
  slug,
  status,
  sessionName,
  defaultOpen = false,
}: DevServerOutputPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
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
      setError("Could not load server output.");
    } finally {
      setLoading(false);
    }
  }, [applyOutput, issueIdentifier, open, projectSlug, serverId]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    if (!STREAM_STATUSES.has(status)) {
      void refresh();
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
          <span>Command output</span>
          {sessionName ? <span className="truncate font-mono text-slate-400">{sessionName}</span> : null}
          {loading ? <Loader2 className="h-3 w-3 animate-spin text-slate-400" /> : null}
        </button>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void refresh()} disabled={!open}>
          Refresh
        </Button>
      </div>

      {open ? (
        <div className="p-2">
          {error ? <p className="mb-2 text-xs text-red-400">{error}</p> : null}
          <pre
            ref={preRef}
            aria-label={`${slug} command output`}
            className={cn(
              "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-slate-100",
              output.trim().length === 0 && "text-slate-500",
            )}
            onScroll={(event) => {
              const element = event.currentTarget;
              const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
              stickToBottomRef.current = nearBottom;
            }}
          >
            {output.trim().length > 0 ? output : "No output captured yet. Output appears here while setup and serve commands run."}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
