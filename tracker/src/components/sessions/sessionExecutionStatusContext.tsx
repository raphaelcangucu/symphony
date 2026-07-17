import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

export interface SessionExecutionStatus {
  projectSlug: string;
  issue: Issue;
  execution?: AgentExecution;
  onIssueUpdated?: (issue: Issue) => void;
}

type PublishSessionExecutionStatus = (status: SessionExecutionStatus | null) => void;

const SessionExecutionStatusContext = createContext<SessionExecutionStatus | null>(null);
const SessionExecutionStatusPublisherContext = createContext<PublishSessionExecutionStatus | null>(null);

/**
 * Lifts the active execution session's status up to the session header bar so a
 * compact, click-to-expand status control can live in the top toolbar while the
 * execution data itself is owned by the panel deeper in the tree.
 */
export function SessionExecutionStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionExecutionStatus | null>(null);

  return (
    <SessionExecutionStatusPublisherContext.Provider value={setStatus}>
      <SessionExecutionStatusContext.Provider value={status}>{children}</SessionExecutionStatusContext.Provider>
    </SessionExecutionStatusPublisherContext.Provider>
  );
}

/** Current execution status published by the active session panel, or null. */
export function useSessionExecutionStatus(): SessionExecutionStatus | null {
  return useContext(SessionExecutionStatusContext);
}

/**
 * Publishes the panel's execution status into the header. No-ops when rendered
 * outside a status-aware session shell. Clears the published value on unmount.
 */
export function usePublishSessionExecutionStatus(status: SessionExecutionStatus | null): void {
  const publish = useContext(SessionExecutionStatusPublisherContext);
  const projectSlug = status?.projectSlug;
  const issue = status?.issue;
  const execution = status?.execution;
  const onIssueUpdated = status?.onIssueUpdated;

  useEffect(() => {
    if (!publish) return undefined;

    publish(issue && projectSlug ? { projectSlug, issue, execution, onIssueUpdated } : null);
    return () => publish(null);
  }, [publish, projectSlug, issue, execution, onIssueUpdated]);
}
