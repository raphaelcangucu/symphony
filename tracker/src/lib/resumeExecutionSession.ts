import axios from "axios";

import type { ProjectSessionRow } from "@/lib/projectSessions";
import type { RecentSession } from "@/types/recents";

export function trackerApiErrorCode(cause: unknown): string | null {
  if (!axios.isAxiosError(cause)) return null;
  const code = (cause.response?.data as { error?: { code?: string } } | undefined)?.error?.code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

export function resolveResumeThreadId(
  issueIdentifier: string,
  session: ProjectSessionRow,
  relatedSessions: readonly RecentSession[],
): number | null {
  const executionSessionId = session.execution.executionSessionId;
  if (executionSessionId != null && executionSessionId > 0) {
    return executionSessionId;
  }

  for (const recent of relatedSessions) {
    if (recent.identifier !== issueIdentifier || recent.threadId == null) continue;
    if (recent.scope === "issue_execution" || recent.scope === "issue_session") {
      return recent.threadId;
    }
  }

  for (const recent of relatedSessions) {
    if (recent.identifier === issueIdentifier && recent.threadId != null) {
      return recent.threadId;
    }
  }

  return null;
}
