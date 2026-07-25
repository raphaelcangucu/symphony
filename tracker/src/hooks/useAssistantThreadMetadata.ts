import { useEffect, useState } from "react";

import { getAssistantThread } from "@/services/assistantThreads";
import type { AssistantThread } from "@/types/assistant-thread";
import type { RecentSession } from "@/types/recents";

function threadFromRecent(
  threadId: number,
  relatedSessions: readonly RecentSession[],
): AssistantThread | null {
  const recent = relatedSessions.find(
    (session) => session.threadId === threadId,
  );
  if (!recent) return null;

  return {
    id: threadId,
    scope: recent.scope ?? "project_session",
    agentKind: recent.agentKind === "opencode" ? null : recent.agentKind,
    requestedModel: null,
    requestedEffort: null,
    resolvedModel: null,
    resolvedEffort: null,
    projectSlug: recent.projectSlug,
    projectName: recent.projectName,
    issueIdentifier: recent.identifier,
    workspacePath: null,
    labels: [],
    needsReview: false,
    title: recent.title,
    status: recent.status,
    preview: recent.preview,
    updatedAt: recent.updatedAt,
  };
}

export function useAssistantThreadMetadata(
  projectSlug: string,
  threadId: number | null,
  relatedSessions: readonly RecentSession[] = [],
): AssistantThread | null {
  const [thread, setThread] = useState<AssistantThread | null>(() =>
    threadId != null && threadId > 0
      ? threadFromRecent(threadId, relatedSessions)
      : null,
  );

  useEffect(() => {
    if (threadId == null || threadId <= 0) {
      setThread(null);
      return;
    }

    let active = true;
    const optimistic = threadFromRecent(threadId, relatedSessions);
    if (optimistic) setThread(optimistic);

    void getAssistantThread(threadId)
      .then((match) => {
        if (!active) return;
        if (
          projectSlug &&
          match.projectSlug &&
          match.projectSlug !== projectSlug
        ) {
          setThread(optimistic);
          return;
        }
        setThread(match);
      })
      .catch(() => {
        if (!active || optimistic) return;
        setThread(null);
      });

    return () => {
      active = false;
    };
    // relatedSessions is only an optimistic seed — identity churn must not re-hit the API.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: seed once per threadId
  }, [projectSlug, threadId]);

  return thread;
}
