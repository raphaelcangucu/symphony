export type IssueTabId = "summary" | "pr" | "comments" | "evidence" | "sessions";

export const ISSUE_TABS: ReadonlyArray<{ id: IssueTabId; label: string }> = [
  { id: "summary", label: "Summary" },
  { id: "pr", label: "PR" },
  { id: "comments", label: "Comments" },
  { id: "evidence", label: "Evidence" },
  { id: "sessions", label: "Sessions" },
];
