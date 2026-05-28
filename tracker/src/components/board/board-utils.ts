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

export function isWorkflowStatusName(value: string): value is WorkflowStatusName {
  return DEFAULT_WORKFLOW_STATUSES.includes(value as WorkflowStatusName);
}

export function emptyBoardState(): BoardState {
  return DEFAULT_WORKFLOW_STATUSES.reduce((accumulator, status) => {
    accumulator[status] = [];
    return accumulator;
  }, {} as BoardState);
}

export function buildBoardState(issues: readonly Issue[]): BoardState {
  const board = emptyBoardState();

  for (const issue of issues) {
    const status = isWorkflowStatusName(issue.status) ? issue.status : "Backlog";
    board[status] = [...board[status], issue];
  }

  for (const status of DEFAULT_WORKFLOW_STATUSES) {
    board[status] = [...board[status]].sort((left, right) => left.position - right.position);
  }

  return board;
}

export function findIssueStatus(board: BoardState, identifier: string): WorkflowStatusName | null {
  for (const status of DEFAULT_WORKFLOW_STATUSES) {
    if (board[status].some((issue) => issue.identifier === identifier)) return status;
  }
  return null;
}

export function moveIssueLocally(
  board: BoardState,
  identifier: string,
  targetStatus: WorkflowStatusName,
  targetIndex: number,
): BoardState {
  if (!identifier.trim()) throw new Error("identifier is required");

  const sourceStatus = findIssueStatus(board, identifier);
  if (!sourceStatus) return board;

  const movingIssue = board[sourceStatus].find((issue) => issue.identifier === identifier);
  if (!movingIssue) return board;

  const next = emptyBoardState();
  for (const status of DEFAULT_WORKFLOW_STATUSES) {
    next[status] = board[status].filter((issue) => issue.identifier !== identifier);
  }

  const boundedIndex = Math.max(0, Math.min(targetIndex, next[targetStatus].length));
  next[targetStatus].splice(boundedIndex, 0, { ...movingIssue, status: targetStatus });

  for (const status of DEFAULT_WORKFLOW_STATUSES) {
    next[status] = next[status].map((issue, position) => ({ ...issue, position }));
  }

  return next;
}

export function flattenBoardState(board: BoardState): Issue[] {
  return DEFAULT_WORKFLOW_STATUSES.flatMap((status) => board[status]);
}
