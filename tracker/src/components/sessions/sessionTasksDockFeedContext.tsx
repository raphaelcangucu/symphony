import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type { AssistantToolCall } from "@/services/assistant";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

export interface SessionTasksDockFeed {
  tasks: AgentTaskSnapshot | null;
  toolItems: readonly AssistantToolCall[];
}

const EMPTY_FEED: SessionTasksDockFeed = { tasks: null, toolItems: [] };

type PublishSessionTasksDockFeed = (feed: SessionTasksDockFeed) => void;

const SessionTasksDockFeedContext = createContext<SessionTasksDockFeed>(EMPTY_FEED);
const SessionTasksDockFeedPublisherContext = createContext<PublishSessionTasksDockFeed | null>(null);

export function SessionTasksDockFeedProvider({ children }: { children: ReactNode }) {
  const [feed, setFeed] = useState<SessionTasksDockFeed>(EMPTY_FEED);
  const publish = useCallback<PublishSessionTasksDockFeed>((next) => {
    const toolItems = next.toolItems ?? [];
    setFeed((current) => {
      if (current.tasks === next.tasks && current.toolItems === toolItems) return current;
      if (
        current.tasks === next.tasks &&
        current.toolItems.length === 0 &&
        toolItems.length === 0
      ) {
        return current;
      }
      return { tasks: next.tasks, toolItems };
    });
  }, []);

  return (
    <SessionTasksDockFeedPublisherContext.Provider value={publish}>
      <SessionTasksDockFeedContext.Provider value={feed}>{children}</SessionTasksDockFeedContext.Provider>
    </SessionTasksDockFeedPublisherContext.Provider>
  );
}

/** Snapshot published by the active session panel for the workspace tasks/tools dock. */
export function useSessionTasksDockFeed(): SessionTasksDockFeed {
  return useContext(SessionTasksDockFeedContext);
}

/**
 * Publishes the current session's tasks + tool activity into the workspace dock.
 * No-ops when rendered outside a dock-aware workspace. Clears on unmount.
 */
export function usePublishSessionTasksDockFeed(feed: SessionTasksDockFeed): void {
  const publish = useContext(SessionTasksDockFeedPublisherContext);
  const tasks = feed.tasks;
  const toolItems = feed.toolItems;

  useEffect(() => {
    if (!publish) return undefined;

    publish({ tasks, toolItems });
    return () => publish(EMPTY_FEED);
  }, [publish, tasks, toolItems]);
}
