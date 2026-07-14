import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface ActivityDisclosureStateProps {
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

export interface ActivityDisclosureProps extends ActivityDisclosureStateProps {
  icon: ReactNode;
  label: ReactNode;
  metadata?: ReactNode;
  status?: "running" | "completed" | "failed" | null;
  statusLabel?: string;
  details?: ReactNode;
  defaultExpanded?: boolean;
  testId?: string;
}

export function ActivityDisclosure({
  icon,
  label,
  metadata,
  status = null,
  statusLabel,
  details,
  defaultExpanded = false,
  expanded,
  onExpandedChange,
  testId,
}: ActivityDisclosureProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(defaultExpanded);
  const controlled = expanded !== undefined;
  const open = controlled ? expanded : uncontrolledExpanded;
  const detailsId = useId();
  const hasDetails =
    details !== null &&
    details !== undefined &&
    details !== false &&
    details !== "";
  const resolvedStatusLabel = statusLabel ?? status;
  const summary = (
    <>
      <span className="shrink-0 text-muted-foreground" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
        {label}
      </span>
      {metadata ? (
        <span className="min-w-0 max-w-[45%] truncate text-[11px] text-muted-foreground">
          {metadata}
        </span>
      ) : null}
      {resolvedStatusLabel ? (
        <span
          className={cn(
            "shrink-0 text-[10px] font-semibold uppercase tracking-wide",
            status === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {resolvedStatusLabel}
        </span>
      ) : null}
      {hasDetails ? (
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      ) : null}
    </>
  );
  const summaryClassName = cn(
    "flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left",
    hasDetails &&
      "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
    status === "failed" && hasDetails && "hover:bg-destructive/5",
  );
  const toggleExpanded = () => {
    const nextExpanded = !open;
    if (!controlled) setUncontrolledExpanded(nextExpanded);
    onExpandedChange?.(nextExpanded);
  };

  return (
    <div className="min-w-0" data-status={status ?? undefined}>
      {hasDetails ? (
        <button
          type="button"
          className={summaryClassName}
          onClick={toggleExpanded}
          aria-expanded={open}
          aria-controls={detailsId}
          aria-busy={status === "running" || undefined}
          data-testid={testId}
        >
          {summary}
        </button>
      ) : (
        <div
          className={summaryClassName}
          aria-busy={status === "running" || undefined}
          data-testid={testId}
        >
          {summary}
        </div>
      )}
      {hasDetails && open ? (
        <div
          id={detailsId}
          className="ml-3 min-w-0 border-l border-border/70 py-1 pl-3"
        >
          {details}
        </div>
      ) : null}
    </div>
  );
}
