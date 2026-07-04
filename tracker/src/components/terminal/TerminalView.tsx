import { useCallback } from "react";

import { useTerminalChannel, type TerminalConnectionKind } from "@/hooks/useTerminalChannel";
import { cn } from "@/lib/utils";

interface TerminalViewProps {
  kind: TerminalConnectionKind;
  projectSlug: string;
  issueIdentifier?: string;
  tabId?: string;
  enabled?: boolean;
  ariaLabel: string;
  className?: string;
}

export function TerminalView({
  kind,
  projectSlug,
  issueIdentifier,
  tabId,
  enabled = true,
  ariaLabel,
  className,
}: TerminalViewProps) {
  const handleActivated = useCallback(() => {
    // Fit is handled inside the hook; this hook exists for future tab-switch reflows.
  }, []);

  const { containerRef, error } = useTerminalChannel({
    kind,
    projectSlug,
    issueIdentifier,
    tabId,
    enabled,
    onActivated: handleActivated,
  });

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
      {error ? (
        <div className="mb-2 shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <div
        aria-label={ariaLabel}
        className="symphony-terminal-host min-h-0 flex-1 rounded-lg border bg-slate-950 p-2"
        ref={containerRef}
      />
    </div>
  );
}
