export type CommentSyncStatus = "synced" | "pending" | "conflict" | "error" | "archived";

export interface Comment {
  id: string;
  issueIdentifier: string;
  author: string | null;
  body: string;
  kind: string | null;
  url: string | null;
  syncStatus: CommentSyncStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommentInput {
  body: string;
}
