import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import type { ProjectRealtimeEventName, ProjectRealtimePayloadByEvent } from "@/types/realtime-events";

import { normalizeBlocker, normalizeComment, type BackendBlockerDto, type BackendCommentDto } from "./comment";
import { normalizeIssue, type BackendIssueDto } from "./issue";

type BackendRealtimePayloadByEvent = {
  issue_created: { issue: BackendIssueDto };
  issue_updated: { issue: BackendIssueDto };
  issue_moved: { issue: BackendIssueDto };
  comment_created: { issue_identifier?: string | null; issueIdentifier?: string | null; comment: BackendCommentDto };
  blocker_changed: { issue_identifier?: string | null; issueIdentifier?: string | null; blocker: BackendBlockerDto };
};

export function normalizeProjectRealtimePayload<TEvent extends ProjectRealtimeEventName>(
  event: TEvent,
  payload: BackendRealtimePayloadByEvent[TEvent],
): ProjectRealtimePayloadByEvent[TEvent] {
  if (event === "comment_created") {
    const commentPayload = payload as BackendRealtimePayloadByEvent["comment_created"];
    const issueIdentifier = normalizeIssueIdentifier(commentPayload.issueIdentifier ?? commentPayload.issue_identifier ?? "");
    return {
      issueIdentifier,
      comment: normalizeComment(commentPayload.comment, issueIdentifier),
    } as ProjectRealtimePayloadByEvent[TEvent];
  }

  if (event === "blocker_changed") {
    const blockerPayload = payload as BackendRealtimePayloadByEvent["blocker_changed"];
    const issueIdentifier = normalizeIssueIdentifier(blockerPayload.issueIdentifier ?? blockerPayload.issue_identifier ?? "");
    return {
      issueIdentifier,
      blocker: normalizeBlocker(blockerPayload.blocker, issueIdentifier),
    } as ProjectRealtimePayloadByEvent[TEvent];
  }

  const issuePayload = payload as BackendRealtimePayloadByEvent["issue_created"];
  return { issue: normalizeIssue(issuePayload.issue) } as ProjectRealtimePayloadByEvent[TEvent];
}
