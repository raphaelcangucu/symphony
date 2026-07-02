import { arrayMove } from "@dnd-kit/sortable";

import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { requireNonBlank } from "@/lib/serviceValidation";
import type { Issue } from "@/types/issue";
import type { WorkflowStatusName } from "@/types/workflow-status";

export const DEFAULT_WORKFLOW_STATUSES = [
  "Backlog",
  "Planning",
  "Todo",
  "In Progress",
  "Human Review",
  "Merging",
  "Rework",
  "Done",
] as const satisfies readonly WorkflowStatusName[];

export type BoardState = Record<WorkflowStatusName, Issue[]>;

export const ISSUE_DRAG_PREFIX = "issue:";
export const PARENT_DRAG_PREFIX = "parent:";

export function issueDragId(identifier: string): string {
  requireNonBlank(identifier, "identifier");
  return `${ISSUE_DRAG_PREFIX}${identifier}`;
}

export function parseDragIssueId(id: unknown): string | null {
  if (typeof id !== "string" || id.trim() === "") return null;
  if (id.startsWith(ISSUE_DRAG_PREFIX)) return id.slice(ISSUE_DRAG_PREFIX.length);
  // A parent card wraps its own issue card, so its drag id resolves to the parent
  // issue for move/reorder/sub-issue intent.
  if (id.startsWith(PARENT_DRAG_PREFIX)) return id.slice(PARENT_DRAG_PREFIX.length);
  return id;
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

export interface BoardMoveResult {
  board: BoardState;
  targetStatus: WorkflowStatusName;
  targetIndex: number;
}

export function resolveBoardMove(
  board: BoardState,
  activeIdentifier: string,
  overId: string,
  statuses?: readonly WorkflowStatusName[],
): BoardMoveResult | null {
  if (!activeIdentifier.trim()) return null;

  const statusNames = workflowStatusNames(statuses ?? Object.keys(board));
  const currentStatus = findIssueStatus(board, activeIdentifier, statusNames);
  if (!currentStatus) return null;

  const targetStatus = isWorkflowStatusName(overId, statusNames)
    ? overId
    : findIssueStatus(board, parseDragIssueId(overId) ?? "", statusNames);
  if (!targetStatus) return null;

  if (currentStatus === targetStatus) {
    const columnIssues = board[currentStatus];
    const oldIndex = columnIssues.findIndex((issue) => issue.identifier === activeIdentifier);
    if (oldIndex === -1) return null;

    const overIdentifier = isWorkflowStatusName(overId, statusNames) ? null : parseDragIssueId(overId);
    const newIndex = overIdentifier
      ? columnIssues.findIndex((issue) => issue.identifier === overIdentifier)
      : columnIssues.length - 1;

    if (newIndex === -1 || oldIndex === newIndex) return null;

    const reordered = arrayMove(columnIssues, oldIndex, newIndex);
    const next = emptyBoardState(statusNames);
    for (const status of statusNames) {
      next[status] =
        status === currentStatus
          ? reordered.map((issue, position) => ({ ...issue, position }))
          : [...board[status]];
    }

    const targetIndex = reordered.findIndex((issue) => issue.identifier === activeIdentifier);
    return { board: next, targetStatus: currentStatus, targetIndex };
  }

  const overIdentifier = parseDragIssueId(overId);
  const overIndex = overIdentifier
    ? board[targetStatus].findIndex((issue) => issue.identifier === overIdentifier)
    : board[targetStatus].length;
  const targetIndex = overIndex >= 0 ? overIndex : board[targetStatus].length;

  return {
    board: moveIssueLocally(board, activeIdentifier, targetStatus, targetIndex, statusNames),
    targetStatus,
    targetIndex,
  };
}

export function moveIssueLocally(
  board: BoardState,
  identifier: string,
  targetStatus: WorkflowStatusName,
  targetIndex: number,
  statuses?: readonly WorkflowStatusName[],
): BoardState {
  requireNonBlank(identifier, "identifier");

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

/**
 * Resolves the anchor issue and the followers that travel with it on a board
 * move. The anchor is the dragged issue itself; a parent drags its direct
 * sub-issues so the parent card and its subtasks land in the same column
 * together. Followers are de-duplicated.
 */
export function resolveMoveUnit(
  issues: readonly Issue[],
  identifier: string,
): { anchorIdentifier: string; followerIdentifiers: string[] } {
  const subtaskIdentifiers = issues
    .filter((issue) => issue.parentIdentifier === identifier)
    .map((issue) => issue.identifier);

  const seen = new Set<string>([identifier]);
  const followerIdentifiers: string[] = [];
  for (const candidate of subtaskIdentifiers) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    followerIdentifiers.push(candidate);
  }

  return { anchorIdentifier: identifier, followerIdentifiers };
}

/**
 * Moves an issue and, when it owns sub-issues, drags its followers into the same
 * column right behind the anchor so the whole unit travels together. Pure board
 * transform used for optimistic updates. Without it the parent would jump
 * columns alone and its sub-issues would be stranded (rendering as loose cards)
 * until the next refetch.
 */
export function moveUnitLocally(
  board: BoardState,
  anchorIdentifier: string,
  followerIdentifiers: readonly string[],
  targetStatus: WorkflowStatusName,
  targetIndex: number,
  statuses?: readonly WorkflowStatusName[],
): BoardState {
  let next = moveIssueLocally(board, anchorIdentifier, targetStatus, targetIndex, statuses);
  for (const followerIdentifier of followerIdentifiers) {
    const anchorIndex = (next[targetStatus] ?? []).findIndex((issue) => issue.identifier === anchorIdentifier);
    const insertAt = anchorIndex >= 0 ? anchorIndex + 1 : (next[targetStatus]?.length ?? 0);
    next = moveIssueLocally(next, followerIdentifier, targetStatus, insertAt, statuses);
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

/** Where a reorder drop would land, rendered as a line above/below a card. */
export interface DropIndicator {
  unitId: string;
  edge: "top" | "bottom";
}

export type BoardUnit =
  | { kind: "issue"; id: string; issue: Issue }
  | { kind: "parent"; id: string; issue: Issue; subtasks: Issue[] };

/** Children whose parentIdentifier points at this issue, ordered like the board. */
export function collectSubtasksForParent(parentIdentifier: string, issues: readonly Issue[]): Issue[] {
  const parentKey = normalizeIssueIdentifier(parentIdentifier);
  if (!parentKey) return [];

  return issues
    .filter(
      (candidate) =>
        candidate.parentIdentifier != null &&
        normalizeIssueIdentifier(candidate.parentIdentifier) === parentKey,
    )
    .sort((left, right) => left.position - right.position);
}

export function buildBoardUnits(issues: readonly Issue[], allIssues?: readonly Issue[]): BoardUnit[] {
  const subtaskSource = allIssues ?? issues;
  const subtasksByParent = new Map<string, Issue[]>();
  for (const issue of subtaskSource) {
    if (!issue.parentIdentifier) continue;
    const parentKey = normalizeIssueIdentifier(issue.parentIdentifier);
    const list = subtasksByParent.get(parentKey) ?? [];
    list.push(issue);
    subtasksByParent.set(parentKey, list);
  }

  const units: BoardUnit[] = [];
  for (const issue of issues) {
    const subtasks = subtasksByParent.get(normalizeIssueIdentifier(issue.identifier)) ?? [];
    const hasSubtasks = subtasks.length > 0 || (issue.subIssueSummary?.total ?? 0) > 0;

    if (hasSubtasks) {
      // Additive (not absorbing): the parent renders an expandable subtask list,
      // but each subtask still gets its own issue unit below (it may live in a
      // different column/repo). Its drag id uses the parent prefix so the wrapper
      // card is the single draggable unit (the inner issue card is presentational).
      units.push({ kind: "parent", id: `${PARENT_DRAG_PREFIX}${issue.identifier}`, issue, subtasks });
    } else {
      units.push({ kind: "issue", id: issueDragId(issue.identifier), issue });
    }
  }

  return units;
}

interface OverRect {
  top: number;
  height: number;
}

/**
 * True when the pointer's Y sits in the over card's middle band (group intent),
 * rather than its top/bottom edges (reorder intent).
 *
 * Using the live pointer position — instead of the dragged card's translated
 * rect — keeps the decision stable even while the reorder preview reflows the
 * column, which is what previously made grouping flip-flop with reordering.
 */
export function mergeIntent(pointerY: number, overRect: OverRect, edgeRatio: number): boolean {
  const edge = overRect.height * edgeRatio;
  return pointerY > overRect.top + edge && pointerY < overRect.top + overRect.height - edge;
}
