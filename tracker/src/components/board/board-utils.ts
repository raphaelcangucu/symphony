import type { Issue } from "@/types/issue";
import type { WorkflowStatusName } from "@/types/workflow-status";

export const DEFAULT_WORKFLOW_STATUSES = [
  "Backlog",
  "Todo",
  "In Progress",
  "Human Review",
  "Merging",
  "Rework",
  "Done",
] as const satisfies readonly WorkflowStatusName[];

export type BoardState = Record<WorkflowStatusName, Issue[]>;

export const ISSUE_DRAG_PREFIX = "issue:";

export function issueDragId(identifier: string): string {
  if (!identifier.trim()) throw new Error("identifier is required");
  return `${ISSUE_DRAG_PREFIX}${identifier}`;
}

export function parseDragIssueId(id: unknown): string | null {
  if (typeof id !== "string" || id.trim() === "") return null;
  return id.startsWith(ISSUE_DRAG_PREFIX) ? id.slice(ISSUE_DRAG_PREFIX.length) : id;
}

export function workflowStatusNames(statuses?: readonly WorkflowStatusName[]): WorkflowStatusName[] {
  return statuses && statuses.length > 0 ? [...statuses] : [...DEFAULT_WORKFLOW_STATUSES];
}

export function isWorkflowStatusName(value: string, statuses?: readonly WorkflowStatusName[]): value is WorkflowStatusName {
  return workflowStatusNames(statuses).includes(value as WorkflowStatusName);
}

export function emptyBoardState(statuses?: readonly WorkflowStatusName[]): BoardState {
  return workflowStatusNames(statuses).reduce((accumulator, status) => {
    accumulator[status] = [];
    return accumulator;
  }, {} as BoardState);
}

export function buildBoardState(issues: readonly Issue[], statuses?: readonly WorkflowStatusName[]): BoardState {
  const statusNames = workflowStatusNames(statuses);
  const board = emptyBoardState(statusNames);
  const fallbackStatus = statusNames[0] ?? "Backlog";

  for (const issue of issues) {
    const status = isWorkflowStatusName(issue.status, statusNames) ? issue.status : fallbackStatus;
    board[status] = [...board[status], issue];
  }

  for (const status of statusNames) {
    board[status] = [...board[status]].sort((left, right) => left.position - right.position);
  }

  return board;
}

export function findIssueStatus(board: BoardState, identifier: string, statuses?: readonly WorkflowStatusName[]): WorkflowStatusName | null {
  for (const status of workflowStatusNames(statuses ?? Object.keys(board))) {
    if (board[status].some((issue) => issue.identifier === identifier)) return status;
  }
  return null;
}

export function moveIssueLocally(
  board: BoardState,
  identifier: string,
  targetStatus: WorkflowStatusName,
  targetIndex: number,
  statuses?: readonly WorkflowStatusName[],
): BoardState {
  if (!identifier.trim()) throw new Error("identifier is required");

  const statusNames = workflowStatusNames(statuses ?? Object.keys(board));
  const sourceStatus = findIssueStatus(board, identifier, statusNames);
  if (!sourceStatus) return board;

  const movingIssue = board[sourceStatus].find((issue) => issue.identifier === identifier);
  if (!movingIssue) return board;

  const next = emptyBoardState(statusNames);
  for (const status of statusNames) {
    next[status] = board[status].filter((issue) => issue.identifier !== identifier);
  }

  const boundedIndex = Math.max(0, Math.min(targetIndex, next[targetStatus].length));
  next[targetStatus].splice(boundedIndex, 0, { ...movingIssue, status: targetStatus });

  for (const status of statusNames) {
    next[status] = next[status].map((issue, position) => ({ ...issue, position }));
  }

  return next;
}

export function flattenBoardState(board: BoardState): Issue[] {
  return Object.keys(board).flatMap((status) => board[status]);
}

export function upsertIssue(issues: readonly Issue[], issue: Issue): Issue[] {
  const index = issues.findIndex((item) => item.identifier === issue.identifier);
  if (index === -1) return [...issues, issue];
  return issues.map((item, itemIndex) => (itemIndex === index ? issue : item));
}
