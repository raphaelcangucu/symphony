import { FileText, Loader2, Pencil, TerminalSquare } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  ActivityDisclosure,
  type ActivityDisclosureStateProps,
} from "@/components/agent-activity/ActivityDisclosure";
import type { FileActivityView } from "@/components/assistant/fileActivity";
import { Button } from "@/components/ui/button";
import { useNowTick } from "@/hooks/useNowTick";
import { formatClockElapsed, formatDurationSeconds } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";

interface FileActivityCardProps extends ActivityDisclosureStateProps {
  view: FileActivityView;
  startedAt?: number | null;
  durationMs?: number | null;
  onKill?: () => void;
}

export function FileActivityCard({
  view,
  startedAt = null,
  durationMs = null,
  onKill,
  expanded,
  onExpandedChange,
}: FileActivityCardProps) {
  const { t } = useTranslation();
  const running = view.status === "running";
  const failed = view.status === "error";
  const verb =
    view.kind === "read"
      ? t("issue.toolCall.fileActivity.read")
      : view.kind === "edit"
        ? t("issue.toolCall.fileActivity.edited")
        : running
          ? t("issue.toolCall.fileActivity.commandRunning")
          : t("issue.toolCall.fileActivity.commandComplete");
  const statusLabel = failed
    ? t("issue.toolCall.status.failed")
    : running && view.kind !== "command"
      ? t("issue.toolCall.status.running")
      : undefined;
  const nowMs = useNowTick(1000, {
    enabled: view.kind === "command" && running && startedAt != null,
  });
  const elapsed =
    view.kind !== "command"
      ? null
      : running && startedAt != null
        ? formatClockElapsed(nowMs - startedAt)
        : durationMs != null
          ? formatDurationSeconds(durationMs / 1000)
          : null;
  const rawCommand =
    view.kind === "command" && view.rawCommand && view.rawCommand !== view.title
      ? view.rawCommand
      : null;
  const details =
    rawCommand || view.body ? (
      <div className="space-y-2">
        {rawCommand ? (
          <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-muted/30 px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground">
            {rawCommand}
          </pre>
        ) : null}
        {view.body ? (
          view.body.language === "diff" ? (
            <DiffBody value={view.body.value} />
          ) : (
            <PlainBody value={view.body.value} />
          )
        ) : null}
      </div>
    ) : null;

  return (
    <ActivityDisclosure
      icon={
        running ? (
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
        ) : (
          <ActivityIcon kind={view.kind} />
        )
      }
      label={
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "shrink-0 text-[10px] font-semibold text-muted-foreground",
              view.kind === "command"
                ? "normal-case tracking-normal"
                : "uppercase tracking-wide",
            )}
          >
            {verb}
          </span>
          <span
            className="min-w-0 truncate font-mono font-normal"
            title={view.title}
          >
            {view.title}
          </span>
        </span>
      }
      metadata={
        <span className="flex items-center gap-1.5 font-mono">
          {view.lineRange ? <span>{view.lineRange}</span> : null}
          {view.additions != null && view.additions > 0 ? (
            <span className="font-semibold text-emerald-500">
              +{view.additions}
            </span>
          ) : null}
          {view.deletions != null && view.deletions > 0 ? (
            <span className="font-semibold text-rose-500">
              −{view.deletions}
            </span>
          ) : null}
          {elapsed ? <span className="tabular-nums">· {elapsed}</span> : null}
        </span>
      }
      status={failed ? "failed" : running ? "running" : null}
      statusLabel={running && view.kind === "command" ? "" : statusLabel}
      trailingAction={
        running && view.kind === "command" && onKill ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onKill}
          >
            {t("assistant.working.kill")}
          </Button>
        ) : null
      }
      details={details}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    />
  );
}

function ActivityIcon({ kind }: { kind: FileActivityView["kind"] }) {
  if (kind === "edit") return <Pencil className="size-3.5" />;
  if (kind === "command") return <TerminalSquare className="size-3.5" />;
  return <FileText className="size-3.5" />;
}

function PlainBody({ value }: { value: string }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
      {value}
    </pre>
  );
}

function DiffBody({ value }: { value: string }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5">
      {value.split("\n").map((line, index) => (
        <div
          key={index}
          className={cn(
            "whitespace-pre-wrap break-words",
            line.startsWith("+") &&
              !line.startsWith("+++") &&
              "text-emerald-300",
            line.startsWith("-") && !line.startsWith("---") && "text-rose-300",
            line.startsWith("@@") && "text-sky-300",
            !/^[+\-@]/.test(line) && "text-slate-300",
          )}
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}
