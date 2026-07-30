import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import {
  ActivityDisclosure,
  type ActivityDisclosureStateProps,
} from "@/components/agent-activity/ActivityDisclosure";
import { cn } from "@/lib/utils";
import type {
  ToolPresentationBadge,
  ToolPresentationLink,
  ToolPresentationStatus,
} from "@/lib/toolCallPresentation";

export interface TypedToolCardShellProps extends ActivityDisclosureStateProps {
  icon: ReactNode;
  verb: string;
  title: string;
  summary?: string | null;
  status?: ToolPresentationStatus | null;
  badges?: ToolPresentationBadge[];
  links?: ToolPresentationLink[];
  details?: ReactNode;
  trailingAction?: ReactNode;
  defaultCollapsed?: boolean;
}

const BADGE_STYLES: Record<ToolPresentationBadge["kind"], string> = {
  ok: "bg-emerald-500/10 text-emerald-600",
  warn: "bg-amber-500/10 text-amber-600",
  run: "bg-sky-500/10 text-sky-600",
  fail: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

export function TypedToolCardShell({
  icon,
  verb,
  title,
  summary = null,
  status = null,
  badges = [],
  links = [],
  details = null,
  trailingAction,
  defaultCollapsed = true,
  expanded,
  onExpandedChange,
}: TypedToolCardShellProps) {
  const running = status === "running";
  const failed = status === "failed";
  const statusLabel = failed ? "failed" : running ? "running" : undefined;
  const metadataParts: ReactNode[] = [];

  if (summary) {
    metadataParts.push(
      <span key="summary" className="truncate">
        {summary}
      </span>,
    );
  }

  for (const badge of badges) {
    metadataParts.push(
      <span
        key={`badge-${badge.label}`}
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
          BADGE_STYLES[badge.kind],
        )}
      >
        {badge.label}
      </span>,
    );
  }

  for (const link of links) {
    metadataParts.push(
      <a
        key={`link-${link.href}`}
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 text-[11px] font-medium text-primary hover:underline"
        onClick={(event) => event.stopPropagation()}
      >
        {link.label}
      </a>,
    );
  }

  return (
    <ActivityDisclosure
      icon={running ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      label={
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {verb}
          </span>
          <span className="min-w-0 truncate font-normal" title={title}>
            {title}
          </span>
        </span>
      }
      metadata={
        metadataParts.length > 0 ? (
          <span className="flex min-w-0 items-center gap-1.5">
            {metadataParts}
          </span>
        ) : null
      }
      status={failed ? "failed" : running ? "running" : null}
      statusLabel={statusLabel}
      details={details}
      trailingAction={trailingAction}
      defaultExpanded={!defaultCollapsed}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    />
  );
}
