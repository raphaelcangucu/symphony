import type { ReactNode } from "react";
import {
  ASSISTANT_CHAT_TYPOGRAPHY_CLASS,
  chatTypographyStyle,
} from "@/components/assistant/chatTypography";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";

export interface AssistantSessionShellProps {
  toolbar?: ReactNode;
  feed: ReactNode;
  /**
   * Rendered as a sibling overlay positioned over the feed viewport, outside
   * the scrolling element (e.g. a scroll-to-bottom button). Unlike `feed`,
   * this is not part of the scrollable content.
   */
  feedOverlay?: ReactNode;
  dock?: ReactNode;
  composer: ReactNode;
  className?: string;
  feedRef?: (node: HTMLDivElement | null) => void;
}

export function AssistantSessionShell({
  toolbar = null,
  feed,
  feedOverlay = null,
  dock = null,
  composer,
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
      <div className="relative min-h-0 flex-1">
        <div
          ref={feedRef}
          data-testid="assistant-session-feed"
          className={cn("h-full overflow-y-auto", SCROLLBAR_THIN)}
        >
          {feed}
        </div>
        {feedOverlay}
      </div>
      {dock ? <div className="shrink-0">{dock}</div> : null}
      <div data-testid="assistant-session-composer" className="shrink-0">
        {composer}
      </div>
    </section>
  );
}
