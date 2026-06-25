import { ChevronDown, Loader2, TerminalSquare, Wrench } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

export type ToolBlockLanguage = "bash" | "json" | "diff" | "markdown" | "text";

export type ToolBlockStatus = "running" | "completed" | "failed" | null;

export interface ToolBlockSection {
  value: string;
  language: ToolBlockLanguage;
}

export interface ToolCallView {
  toolType: string;
  description: string | null;
  status: ToolBlockStatus;
  input: ToolBlockSection | null;
  output: ToolBlockSection | null;
  defaultCollapsed: boolean;
}

const MAX_LINES = 20;
const MAX_CHARS = 2048;

export function ToolCallBlock({ view }: { view: ToolCallView }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(!view.defaultCollapsed);
  const failed = view.status === "failed";
  const running = view.status === "running";
  const statusLabel = view.status ? t(`issue.toolCall.status.${view.status}`) : null;

  return (
    <article
      className={cn(
        "overflow-hidden rounded-xl border",
        failed ? "border-destructive/40 bg-destructive/5" : "border-sky-500/20 bg-sky-500/5",
      )}
    >
      <button
        type="button"
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="mt-0.5 text-muted-foreground">
          {running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : view.toolType === "Bash" ? (
            <TerminalSquare className="size-3.5" />
          ) : (
            <Wrench className="size-3.5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-mono text-xs font-semibold text-foreground">{view.toolType}</span>
          {view.description ? <span className="ml-2 text-[11px] text-muted-foreground">{view.description}</span> : null}
        </span>
        {statusLabel ? (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
              failed ? "border-destructive/40 text-destructive" : "border-border/60 text-muted-foreground",
            )}
          >
            {statusLabel}
          </span>
        ) : null}
        <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border/60 px-3 py-2.5">
          {view.input ? <Section label={t("issue.toolCall.input")} section={view.input} showMore={t("issue.toolCall.showMore")} /> : null}
          {view.output ? <Section label={t("issue.toolCall.output")} section={view.output} showMore={t("issue.toolCall.showMore")} /> : null}
        </div>
      ) : null}
    </article>
  );
}

function Section({ label, section, showMore }: { label: string; section: ToolBlockSection; showMore: string }) {
  const [expanded, setExpanded] = useState(false);
  const { visible, truncated } = clamp(section.value, expanded);

  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
        {visible}
      </pre>
      {truncated ? (
        <button
          type="button"
          className="mt-1 text-[11px] font-medium text-primary hover:underline"
          onClick={() => setExpanded(true)}
        >
          {showMore}
        </button>
      ) : null}
    </div>
  );
}

function clamp(value: string, expanded: boolean): { visible: string; truncated: boolean } {
  if (expanded) return { visible: value, truncated: false };

  const lines = value.split("\n");
  const tooManyLines = lines.length > MAX_LINES;
  const tooLong = value.length > MAX_CHARS;
  if (!tooManyLines && !tooLong) return { visible: value, truncated: false };

  const byLines = lines.slice(0, MAX_LINES).join("\n");
  const clamped = byLines.length > MAX_CHARS ? byLines.slice(0, MAX_CHARS) : byLines;
  return { visible: clamped, truncated: true };
}
