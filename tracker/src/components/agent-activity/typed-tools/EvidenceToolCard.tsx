import { CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";

import {
  TypedToolCardShell,
  type TypedToolCardShellProps,
} from "@/components/agent-activity/typed-tools/TypedToolCardShell";
import type { ToolPresentation } from "@/lib/toolCallPresentation";

type EvidenceToolCardProps = Omit<
  TypedToolCardShellProps,
  "icon" | "verb" | "title" | "summary" | "status" | "badges" | "links" | "details"
> & {
  presentation: ToolPresentation;
};

function buildDetails(presentation: ToolPresentation): ReactNode {
  const { body, raw, meta } = presentation;
  const gateSatisfied = meta.gateSatisfied ?? meta.satisfied;
  const violations = Array.isArray(meta.violations)
    ? meta.violations.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const metaLines: ReactNode[] = [];

  if (typeof gateSatisfied === "boolean") {
    metaLines.push(
      <div key="gate">
        Gate:{" "}
        <span className={gateSatisfied ? "font-medium text-emerald-600" : "font-medium text-destructive"}>
          {gateSatisfied ? "satisfied" : "not satisfied"}
        </span>
      </div>,
    );
  }

  if (violations.length > 0) {
    metaLines.push(
      <div key="violations" className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Violations
        </div>
        <ul className="list-disc space-y-0.5 pl-4">
          {violations.map((violation) => (
            <li key={violation}>{violation}</li>
          ))}
        </ul>
      </div>,
    );
  }

  if (!body && !raw && metaLines.length === 0) {
    return null;
  }

  return (
    <div className="min-w-0 space-y-2">
      {metaLines.length > 0 ? (
        <div className="space-y-2 text-[11px] text-muted-foreground">{metaLines}</div>
      ) : null}
      {body ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
          {body}
        </pre>
      ) : null}
      {raw ? (
        <div className="min-w-0 space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Technical details
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
            {raw}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export function EvidenceToolCard({ presentation, ...shellProps }: EvidenceToolCardProps) {
  return (
    <TypedToolCardShell
      icon={<CheckCircle2 className="size-3.5" aria-hidden />}
      verb="Evidence"
      title={presentation.title}
      summary={presentation.summary}
      status={presentation.status}
      badges={presentation.badges}
      links={presentation.links}
      details={buildDetails(presentation)}
      defaultCollapsed
      {...shellProps}
    />
  );
}
