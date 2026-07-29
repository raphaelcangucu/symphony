import { FileText, Loader2, Pencil, TerminalSquare } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  ActivityDisclosure,
  type ActivityDisclosureStateProps,
} from "@/components/agent-activity/ActivityDisclosure";
import type { FileActivityView } from "@/components/assistant/fileActivity";
import { cn } from "@/lib/utils";

interface FileActivityCardProps extends ActivityDisclosureStateProps {
  view: FileActivityView;
}

export function FileActivityCard({
  view,
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

  return (
    <ActivityDisclosure
      icon={
        running ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ActivityIcon kind={view.kind} />
        )
      }
      label={
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {verb}
          </span>
          <span className="min-w-0 truncate font-mono font-normal" title={view.title}>
            {view.title}
          </span>
        </span>
      }
      metadata={
        <span className="flex items-center gap-1.5 font-mono">
          {view.lineRange ? <span>{view.lineRange}</span> : null}
          {view.additions != null && view.additions > 0 ? (
            <span className="font-semibold text-emerald-500">+{view.additions}</span>
          ) : null}
          {view.deletions != null && view.deletions > 0 ? (
            <span className="font-semibold text-rose-500">−{view.deletions}</span>
          ) : null}
        </span>
      }
      status={failed ? "failed" : running ? "running" : null}
      statusLabel={statusLabel}
      details={
        view.body ? (
          view.body.language === "diff" ? (
            <DiffBody value={view.body.value} />
          ) : (
            <PlainBody value={view.body.value} />
          )
        ) : null
      }
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
            line.startsWith("+") && !line.startsWith("+++") && "text-emerald-300",
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
