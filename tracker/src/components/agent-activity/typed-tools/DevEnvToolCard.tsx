import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  TypedToolCardShell,
  type TypedToolCardShellProps,
} from "@/components/agent-activity/typed-tools/TypedToolCardShell";
import type { ToolPresentation } from "@/lib/toolCallPresentation";

type DevEnvToolCardProps = Omit<
  TypedToolCardShellProps,
  "icon" | "verb" | "title" | "summary" | "status" | "badges" | "links" | "details"
> & {
  presentation: ToolPresentation;
};

type DevEnvStep = {
  description?: string;
  command?: string;
  status?: string;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseSteps(value: unknown): DevEnvStep[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DevEnvStep => Boolean(item) && typeof item === "object");
}

function buildSummary(presentation: ToolPresentation): string | null {
  const parts: string[] = [];
  if (presentation.summary?.trim()) {
    parts.push(presentation.summary.trim());
  }

  const port = presentation.meta.port;
  const status = stringOrNull(presentation.meta.status);
  if (typeof port === "number") {
    parts.push(`port ${port}`);
  }
  if (status) {
    parts.push(status);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function stepLabel(step: DevEnvStep): string {
  const description = stringOrNull(step.description);
  const command = stringOrNull(step.command);
  if (description && command) return `${description} — ${command}`;
  return description ?? command ?? "Step";
}

function buildDetails(presentation: ToolPresentation, technicalDetailsLabel: string): ReactNode {
  const { body, raw, meta } = presentation;
  const steps = parseSteps(meta.steps);
  const metaLines: ReactNode[] = [];

  const port = meta.port;
  const status = stringOrNull(meta.status);
  if (typeof port === "number") {
    metaLines.push(
      <div key="port">
        Port: <span className="font-medium">{port}</span>
      </div>,
    );
  }
  if (status) {
    metaLines.push(
      <div key="status">
        Status: <span className="font-medium">{status}</span>
      </div>,
    );
  }

  if (!body && !raw && metaLines.length === 0 && steps.length === 0) {
    return null;
  }

  return (
    <div className="min-w-0 space-y-2">
      {metaLines.length > 0 ? (
        <div className="space-y-1 text-[11px] text-muted-foreground">{metaLines}</div>
      ) : null}
      {steps.length > 0 ? (
        <ul className="space-y-1 text-[11px] text-muted-foreground">
          {steps.map((step, index) => (
            <li key={`${stepLabel(step)}-${index}`} className="flex items-start gap-2">
              <span className="shrink-0 font-medium uppercase tracking-wide">
                {stringOrNull(step.status) ?? "•"}
              </span>
              <span>{stepLabel(step)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {body ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
          {body}
        </pre>
      ) : null}
      {raw ? (
        <div className="min-w-0 space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {technicalDetailsLabel}
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
            {raw}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export function DevEnvToolCard({ presentation, ...shellProps }: DevEnvToolCardProps) {
  const { t } = useTranslation();

  return (
    <TypedToolCardShell
      icon={<Settings className="size-3.5" aria-hidden />}
      verb={t("issue.toolCall.typed.families.devenv")}
      title={presentation.title}
      summary={buildSummary(presentation)}
      status={presentation.status}
      badges={presentation.badges}
      links={presentation.links}
      details={buildDetails(presentation, t("issue.toolCall.typed.technicalDetails"))}
      defaultCollapsed
      {...shellProps}
    />
  );
}
