import { ChevronDown, FileText, Loader2, Pencil, TerminalSquare } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { FileActivityView } from "@/components/assistant/fileActivity";
import { cn } from "@/lib/utils";

export function FileActivityCard({ view }: { view: FileActivityView }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const running = view.status === "running";
  const failed = view.status === "error";
  const verb =
    view.kind === "read"
      ? t("issue.toolCall.fileActivity.read")
      : view.kind === "edit"
        ? t("issue.toolCall.fileActivity.edited")
        : t("issue.toolCall.fileActivity.command");

  return (
    <article
      className={cn(
        "overflow-hidden rounded-xl border",
        failed ? "border-destructive/40 bg-destructive/5" : "border-border/60 bg-muted/30",
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-busy={running}
      >
        <span className="shrink-0 text-muted-foreground">
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <ActivityIcon kind={view.kind} />}
        </span>
        <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{verb}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={view.title}>
          {view.title}
        </span>
        {view.lineRange ? <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{view.lineRange}</span> : null}
        {view.additions != null && view.additions > 0 ? (
          <span className="shrink-0 font-mono text-[11px] font-semibold text-emerald-500">+{view.additions}</span>
        ) : null}
        {view.deletions != null && view.deletions > 0 ? (
          <span className="shrink-0 font-mono text-[11px] font-semibold text-rose-500">−{view.deletions}</span>
        ) : null}
        {view.body ? (
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        ) : null}
      </button>
      {open && view.body ? (
        <div className="border-t border-border/60 px-3 py-2.5">
          {view.body.language === "diff" ? <DiffBody value={view.body.value} /> : <PlainBody value={view.body.value} />}
        </div>
      ) : null}
    </article>
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
