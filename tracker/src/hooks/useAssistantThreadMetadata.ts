import { useEffect, useState } from "react";

import { listAssistantThreads } from "@/services/assistantThreads";
import type { AssistantThread } from "@/types/assistant-thread";
import type { RecentSession } from "@/types/recents";

export function useAssistantThreadMetadata(
  projectSlug: string,
  threadId: number | null,
  relatedSessions: readonly RecentSession[] = [],
): AssistantThread | null {
  const [thread, setThread] = useState<AssistantThread | null>(null);

  useEffect(() => {
    if (threadId == null || threadId <= 0) {
      setThread(null);
      return;
    }

    let active = true;

    const recent = relatedSessions.find((session) => session.threadId === threadId);
    if (recent) {
      setThread({
        id: threadId,
        scope: recent.scope ?? "project_session",
        agentKind: recent.agentKind === "opencode" ? null : recent.agentKind,
        projectSlug: recent.projectSlug,
        projectName: recent.projectName,
        issueIdentifier: recent.identifier,
        title: recent.title,
        status: recent.status,
        preview: recent.preview,
        updatedAt: recent.updatedAt,
      });
    }

    void listAssistantThreads({ projectSlug, limit: 100 })
      .then((threads) => {
        if (!active) return;
        const match = threads.find((entry) => entry.id === threadId);
        if (match) setThread(match);
      })
      .catch(() => {
        if (!active || recent) return;
        setThread(null);
      });

    return () => {
      active = false;
    };
  }, [projectSlug, relatedSessions, threadId]);

  return thread;
}
