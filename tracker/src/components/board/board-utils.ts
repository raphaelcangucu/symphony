import { arrayMove } from "@dnd-kit/sortable";

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
export const GROUP_DRAG_PREFIX = "group:";

export function issueDragId(identifier: string): string {
  requireNonBlank(identifier, "identifier");
  return `${ISSUE_DRAG_PREFIX}${identifier}`;
}

export function parseDragIssueId(id: unknown): string | null {
  if (typeof id !== "string" || id.trim() === "") return null;
  if (id.startsWith(ISSUE_DRAG_PREFIX)) return id.slice(ISSUE_DRAG_PREFIX.length);
  // A group's drag id encodes its lead, so dragging the group resolves to moving
  // (and reordering against) the lead issue.
  if (id.startsWith(GROUP_DRAG_PREFIX)) return id.slice(GROUP_DRAG_PREFIX.length);
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

export function resolveGroupMoveLead(
  issues: readonly Issue[],
  identifier: string,
): { leadIdentifier: string; memberIdentifiers: string[] } {
  const issue = issues.find((candidate) => candidate.identifier === identifier);
  const leadIdentifier = issue?.groupLeadIdentifier ?? identifier;
  const lead = issues.find((candidate) => candidate.identifier === leadIdentifier) ?? issue;

  return {
    leadIdentifier,
    memberIdentifiers: lead?.groupMemberIdentifiers ?? [],
  };
}

/**
 * Moves an issue and, when it leads a group, drags its members into the same
 * column right behind the lead so the whole group travels as one unit. Pure
 * board transform used for optimistic updates; the server mirrors this through
 * `move_group_members`. Without it the lead would jump columns alone and its
 * members would be stranded (rendering as loose cards) until the next refetch.
 */
export function moveGroupLocally(
  board: BoardState,
  leadIdentifier: string,
  memberIdentifiers: readonly string[],
  targetStatus: WorkflowStatusName,
  targetIndex: number,
  statuses?: readonly WorkflowStatusName[],
): BoardState {
  let next = moveIssueLocally(board, leadIdentifier, targetStatus, targetIndex, statuses);
  for (const memberIdentifier of memberIdentifiers) {
    const leadIndex = (next[targetStatus] ?? []).findIndex((issue) => issue.identifier === leadIdentifier);
    const insertAt = leadIndex >= 0 ? leadIndex + 1 : (next[targetStatus]?.length ?? 0);
    next = moveIssueLocally(next, memberIdentifier, targetStatus, insertAt, statuses);
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
  | { kind: "group"; id: string; lead: Issue; members: Issue[] };

export function groupIssuesIntoUnits(issues: readonly Issue[]): BoardUnit[] {
  const byIdentifier = new Map(issues.map((issue) => [issue.identifier, issue]));
  const absorbed = new Set<string>();
  for (const issue of issues) {
    if (issue.groupMemberIdentifiers.length > 0) {
      for (const memberId of issue.groupMemberIdentifiers) absorbed.add(memberId);
    }
  }

  const units: BoardUnit[] = [];
  for (const issue of issues) {
    if (issue.groupLeadIdentifier && absorbed.has(issue.identifier)) continue;

    if (issue.groupMemberIdentifiers.length > 0) {
      const members = issue.groupMemberIdentifiers
        .map((id) => byIdentifier.get(id))
        .filter((member): member is Issue => Boolean(member));
      units.push({ kind: "group", id: `${GROUP_DRAG_PREFIX}${issue.identifier}`, lead: issue, members });
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
