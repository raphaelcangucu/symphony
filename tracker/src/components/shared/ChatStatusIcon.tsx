import { MessageSquare } from "lucide-react";

import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import { executionStatusDotClass } from "@/lib/statusPresentation";
import { cn } from "@/lib/utils";
import type { AgentExecutionStatus } from "@/types/agent-execution";
import type { RecentStatusKind } from "@/types/recents";

/** Shared chat glyph + status bolinha used by sidebar sessions and Workspaces detail. */
export const CHAT_STATUS_ICON_SIZE = "h-3.5 w-3.5";
export const CHAT_STATUS_DOT_SIZE = "h-1.5 w-1.5";
export const CHAT_STATUS_STROKE = 2;

interface ChatStatusIconProps {
  statusKind?: RecentStatusKind | null;
  executionStatus?: AgentExecutionStatus | null;
  className?: string;
}

export function ChatStatusIcon({
  statusKind = null,
  executionStatus = null,
  className,
}: ChatStatusIconProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex h-4 w-4 shrink-0 items-center justify-center text-foreground/70",
        className,
      )}
    >
      <MessageSquare className={CHAT_STATUS_ICON_SIZE} strokeWidth={CHAT_STATUS_STROKE} />
      {executionStatus ? (
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 inline-block rounded-full",
            CHAT_STATUS_DOT_SIZE,
            executionStatusDotClass(executionStatus),
          )}
        />
      ) : statusKind ? (
        <span className="absolute -right-0.5 -top-0.5">
          <RecentStatusDot statusKind={statusKind} className={CHAT_STATUS_DOT_SIZE} />
        </span>
      ) : (
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 inline-block rounded-full bg-muted-foreground/40",
            CHAT_STATUS_DOT_SIZE,
          )}
        />
      )}
    </span>
  );
}
