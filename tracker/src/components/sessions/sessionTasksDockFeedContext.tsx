import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { workspaceScopeKey, type WorkspaceScope } from "@/lib/workspaceScope";
import type { AssistantToolCall } from "@/services/assistant";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

export interface SessionTasksDockFeed {
  tasks: AgentTaskSnapshot | null;
  toolItems: readonly AssistantToolCall[];
}

const EMPTY_FEED: SessionTasksDockFeed = { tasks: null, toolItems: [] };

interface SessionTasksDockFeedEntry {
  owner: symbol;
  feed: SessionTasksDockFeed;
}

type SessionTasksDockFeeds = ReadonlyMap<string, SessionTasksDockFeedEntry>;
type PublishSessionTasksDockFeed = (
  scopeKey: string,
  owner: symbol,
  feed: SessionTasksDockFeed | null,
) => void;

const EMPTY_FEEDS: SessionTasksDockFeeds = new Map();
const SessionTasksDockFeedContext = createContext<SessionTasksDockFeeds>(EMPTY_FEEDS);
const SessionTasksDockFeedPublisherContext = createContext<PublishSessionTasksDockFeed | null>(null);

export function SessionTasksDockFeedProvider({ children }: { children: ReactNode }) {
  const [feeds, setFeeds] = useState<SessionTasksDockFeeds>(EMPTY_FEEDS);
  const publish = useCallback<PublishSessionTasksDockFeed>((scopeKey, owner, next) => {
    setFeeds((current) => {
      const currentEntry = current.get(scopeKey);
      if (next === null) {
        if (currentEntry?.owner !== owner) return current;
        const updated = new Map(current);
        updated.delete(scopeKey);
        return updated;
      }

      const toolItems = next.toolItems ?? [];
      if (
        currentEntry?.owner === owner &&
        currentEntry.feed.tasks === next.tasks &&
        (currentEntry.feed.toolItems === toolItems ||
          (currentEntry.feed.toolItems.length === 0 && toolItems.length === 0))
      ) {
        return current;
      }

      const updated = new Map(current);
      updated.set(scopeKey, {
        owner,
        feed: { tasks: next.tasks, toolItems },
      });
      return updated;
    });
  }, []);

  return (
    <SessionTasksDockFeedPublisherContext.Provider value={publish}>
      <SessionTasksDockFeedContext.Provider value={feeds}>{children}</SessionTasksDockFeedContext.Provider>
    </SessionTasksDockFeedPublisherContext.Provider>
  );
}

/** Snapshot published for the workspace scope shown in the tasks/tools dock. */
export function useSessionTasksDockFeed(scope: WorkspaceScope): SessionTasksDockFeed {
  const feeds = useContext(SessionTasksDockFeedContext);
  return feeds.get(workspaceScopeKey(scope))?.feed ?? EMPTY_FEED;
}

/**
 * Publishes the current session's tasks + tool activity into the workspace dock.
 * No-ops when rendered outside a dock-aware workspace. Clears on unmount.
 */
export function usePublishSessionTasksDockFeed(
  scope: WorkspaceScope | null,
  feed: SessionTasksDockFeed,
): void {
  const publish = useContext(SessionTasksDockFeedPublisherContext);
  const ownerRef = useRef(Symbol("session-tasks-dock-feed"));
  const scopeKey = scope ? workspaceScopeKey(scope) : null;
  const tasks = feed.tasks;
  const toolItems = feed.toolItems;

  useEffect(() => {
    if (!publish || !scopeKey) return undefined;

    const owner = ownerRef.current;
    publish(scopeKey, owner, { tasks, toolItems });
    return () => publish(scopeKey, owner, null);
  }, [publish, scopeKey, tasks, toolItems]);
}
