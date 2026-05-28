import type { Blocker } from "./blocker";
import type { Comment } from "./comment";
import type { Issue } from "./issue";

export type ProjectRealtimeEventName =
  | "issue_created"
  | "issue_updated"
  | "issue_moved"
  | "comment_created"
  | "blocker_changed";

export interface IssueRealtimePayload {
  issue: Issue;
}

export interface CommentCreatedPayload {
  issueIdentifier: string;
  comment: Comment;
}

export interface BlockerChangedPayload {
  issueIdentifier: string;
  blocker: Blocker;
}

export type ProjectRealtimePayloadByEvent = {
  issue_created: IssueRealtimePayload;
  issue_updated: IssueRealtimePayload;
  issue_moved: IssueRealtimePayload;
  comment_created: CommentCreatedPayload;
  blocker_changed: BlockerChangedPayload;
};

export type ProjectRealtimeEvent = {
  [K in ProjectRealtimeEventName]: {
    event: K;
    payload: ProjectRealtimePayloadByEvent[K];
  };
}[ProjectRealtimeEventName];
