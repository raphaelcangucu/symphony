export type IssueDocumentKind = "spec" | "plan" | "handoff";

export interface IssueDocument {
  id: string;
  kind: IssueDocumentKind;
  path: string;
  title: string;
  updatedAt: string | null;
}

export interface IssueDocumentList {
  available: boolean;
  reason: string | null;
  documents: IssueDocument[];
}
