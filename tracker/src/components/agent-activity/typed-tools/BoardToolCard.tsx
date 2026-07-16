import { AlertTriangle, ArrowRight, List } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  TypedToolCardShell,
  type TypedToolCardShellProps,
} from "@/components/agent-activity/typed-tools/TypedToolCardShell";
import type { ToolPresentation, ToolPresentationBadge } from "@/lib/toolCallPresentation";

type BoardToolCardProps = Omit<
  TypedToolCardShellProps,
  "icon" | "verb" | "title" | "summary" | "status" | "badges" | "links" | "details"
> & {
  presentation: ToolPresentation;
};

function verbForFamily(
  family: ToolPresentation["family"],
  translate: (key: string) => string,
): string {
  switch (family) {
    case "board_query":
      return translate("issue.toolCall.typed.families.board");
    case "acceptance":
      return translate("issue.toolCall.typed.families.acceptance");
    default:
      return translate("issue.toolCall.typed.families.board");
  }
}

function iconForFamily(family: ToolPresentation["family"]): ReactNode {
  switch (family) {
    case "board_query":
      return <List className="size-3.5" aria-hidden />;
    case "acceptance":
      return <AlertTriangle className="size-3.5" aria-hidden />;
    default:
      return <ArrowRight className="size-3.5" aria-hidden />;
  }
}

function resolveBadges(presentation: ToolPresentation): ToolPresentationBadge[] {
  const badges = [...presentation.badges];
  if (presentation.family === "acceptance" && presentation.meta.error && !badges.some((b) => b.kind === "warn")) {
    badges.push({ kind: "warn", label: "error" });
  }
  return badges;
}

function buildDetails(presentation: ToolPresentation, technicalDetailsLabel: string): ReactNode {
  const { body, raw, meta } = presentation;
  const issueId = stringOrNull(meta.issue_id);
  const status = stringOrNull(meta.status);
  const metaLines: ReactNode[] = [];

  if (issueId) {
    metaLines.push(
      <div key="issue-id">
        Issue: <span className="font-medium">{issueId}</span>
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

  if (presentation.family === "acceptance" && meta.error) {
    metaLines.push(
      <div key="error" className="text-amber-600">
        {stringOrNull(meta.error) ?? "Update failed"}
      </div>,
    );
  }

  if (!body && !raw && metaLines.length === 0) {
    return null;
  }

  return (
    <div className="min-w-0 space-y-2">
      {metaLines.length > 0 ? (
        <div className="space-y-1 text-[11px] text-muted-foreground">{metaLines}</div>
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

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function BoardToolCard({ presentation, ...shellProps }: BoardToolCardProps) {
  const { t } = useTranslation();

  return (
    <TypedToolCardShell
      icon={iconForFamily(presentation.family)}
      verb={verbForFamily(presentation.family, t)}
      title={presentation.title}
      summary={presentation.summary}
      status={presentation.status}
      badges={resolveBadges(presentation)}
      links={presentation.links}
      details={buildDetails(presentation, t("issue.toolCall.typed.technicalDetails"))}
      defaultCollapsed
      {...shellProps}
    />
  );
}
