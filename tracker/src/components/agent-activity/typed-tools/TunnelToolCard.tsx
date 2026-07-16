import { ArrowLeftRight } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  TypedToolCardShell,
  type TypedToolCardShellProps,
} from "@/components/agent-activity/typed-tools/TypedToolCardShell";
import type { ToolPresentation, ToolPresentationBadge } from "@/lib/toolCallPresentation";

type TunnelToolCardProps = Omit<
  TypedToolCardShellProps,
  "icon" | "verb" | "title" | "summary" | "status" | "badges" | "links" | "details"
> & {
  presentation: ToolPresentation;
};

function resolveBadges(presentation: ToolPresentation): ToolPresentationBadge[] {
  const badges = [...presentation.badges];
  const running = presentation.meta.running;
  if (running === true && !badges.some((badge) => badge.label.toLowerCase() === "running")) {
    badges.unshift({ kind: "run", label: "running" });
  }
  return badges;
}

function buildDetails(presentation: ToolPresentation, technicalDetailsLabel: string): ReactNode {
  const { body, raw } = presentation;
  if (!body && !raw) {
    return null;
  }

  return (
    <div className="min-w-0 space-y-2">
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

export function TunnelToolCard({ presentation, ...shellProps }: TunnelToolCardProps) {
  const { t } = useTranslation();

  return (
    <TypedToolCardShell
      icon={<ArrowLeftRight className="size-3.5" aria-hidden />}
      verb={t("issue.toolCall.typed.families.tunnel")}
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
