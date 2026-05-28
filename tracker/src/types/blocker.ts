export type BlockerState = "open" | "resolved" | "canceled";

export interface BlockerSummary {
  id: string;
  identifier: string;
  state: BlockerState | string | null;
}

export interface Blocker {
  id: string;
  issueIdentifier: string;
  blockingIssueIdentifier: string | null;
  reason: string;
  state: BlockerState;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBlockerInput {
  blockingIssueIdentifier?: string | null;
  type?: string;
}
