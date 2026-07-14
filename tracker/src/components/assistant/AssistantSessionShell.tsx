import type { ReactNode } from "react";
import {
  ASSISTANT_CHAT_TYPOGRAPHY_CLASS,
  chatTypographyStyle,
} from "@/components/assistant/chatTypography";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";

export interface AssistantSessionShellProps {
  toolbar?: ReactNode;
  feed: ReactNode;
  dock?: ReactNode;
  composer: ReactNode;
  environment?: ReactNode;
  className?: string;
  feedRef?: (node: HTMLDivElement | null) => void;
}

export function AssistantSessionShell({
  toolbar = null,
  feed,
  dock = null,
  composer,
  environment = null,
  className,
  feedRef,
}: AssistantSessionShellProps) {
  return (
    <section
      data-testid="assistant-session-shell"
      className={cn(
        "relative flex h-full min-h-0 flex-col overflow-hidden bg-background",
        ASSISTANT_CHAT_TYPOGRAPHY_CLASS,
        className,
      )}
      style={chatTypographyStyle()}
    >
      {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
      <div
        ref={feedRef}
        data-testid="assistant-session-feed"
        className={cn("min-h-0 flex-1 overflow-y-auto", SCROLLBAR_THIN)}
      >
        {feed}
      </div>
      {dock ? <div className="shrink-0">{dock}</div> : null}
      <div data-testid="assistant-session-composer" className="shrink-0">
        {composer}
      </div>
      {environment}
    </section>
  );
}
