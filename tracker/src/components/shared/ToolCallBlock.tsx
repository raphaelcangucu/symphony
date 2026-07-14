import { Loader2, TerminalSquare, Wrench } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ActivityDisclosure,
  type ActivityDisclosureStateProps,
} from "@/components/agent-activity/ActivityDisclosure";

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

interface ToolCallBlockProps extends ActivityDisclosureStateProps {
  view: ToolCallView;
}

export function ToolCallBlock({
  view,
  expanded,
  onExpandedChange,
}: ToolCallBlockProps) {
  const { t } = useTranslation();
  const failed = view.status === "failed";
  const running = view.status === "running";
  const statusLabel = view.status ? t(`issue.toolCall.status.${view.status}`) : null;
  const details =
    view.input || view.output ? (
      <div className="min-w-0 space-y-2">
        {view.input ? (
          <Section
            label={t("issue.toolCall.input")}
            section={view.input}
            showMore={t("issue.toolCall.showMore")}
          />
        ) : null}
        {view.output ? (
          <Section
            label={t("issue.toolCall.output")}
            section={view.output}
            showMore={t("issue.toolCall.showMore")}
          />
        ) : null}
      </div>
    ) : null;

  return (
    <ActivityDisclosure
      icon={
        running ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : view.toolType === "Bash" ? (
          <TerminalSquare className="size-3.5" />
        ) : (
          <Wrench className="size-3.5" />
        )
      }
      label={<span className="font-mono font-semibold">{view.toolType}</span>}
      metadata={view.description}
      status={failed ? "failed" : running ? "running" : view.status}
      statusLabel={statusLabel ?? undefined}
      details={details}
      defaultExpanded={!view.defaultCollapsed}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    />
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
