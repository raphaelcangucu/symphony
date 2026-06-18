import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  type DragCancelEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { WorkflowStatus, WorkflowStatusCategory, WorkflowStatusName } from "@/types/workflow-status";

import { BoardColumn } from "./BoardColumn";
import { boardCollisionDetection } from "./board-collision";
import {
  mergeIntent,
  parseDragIssueId,
  resolveBoardMove,
  workflowStatusNames,
  GROUP_DRAG_PREFIX,
  ISSUE_DRAG_PREFIX,
  type BoardState,
  type DropIndicator,
} from "./board-utils";
import { IssueCard } from "./IssueCard";

/**
 * Merge uses hysteresis so the gesture can't oscillate with reordering:
 * the pointer must reach the middle 50% of a card to *enter* group mode, but
 * only leaves it once the pointer is within the outer 10% (middle 80%). This
 * stops the merge<->reorder feedback loop that reflows the column on every
 * frame (which previously flickered for users and could exhaust React's
 * update depth under fast input).
 */
const MERGE_ENTER_EDGE_RATIO = 0.25;
const MERGE_EXIT_EDGE_RATIO = 0.1;

/**
 * Live pointer Y in viewport coordinates, derived from where the drag started
 * plus how far it has moved. This stays accurate even while the reorder preview
 * reflows the column (unlike the dragged card's own translated rect).
 */
function dragPointerY(event: DragMoveEvent | DragOverEvent): number | null {
  const activator = event.activatorEvent as { clientY?: number; touches?: TouchList } | null;
  const startY =
    typeof activator?.clientY === "number" ? activator.clientY : (activator?.touches?.[0]?.clientY ?? null);
  return startY == null ? null : startY + event.delta.y;
}

interface BoardViewProps {
  board: BoardState;
  statuses?: WorkflowStatusName[];
  workflowStatuses?: WorkflowStatus[];
  projectSlug: string;
  onIssueCreated?: (issue: Issue) => void;
  onSelectIssue: (issue: Issue) => void;
  onMoveIssue: (identifier: string, status: WorkflowStatusName, position: number) => Promise<void> | void;
  collapsedStatuses: ReadonlySet<string>;
  onToggleCollapse: (status: WorkflowStatusName) => void;
  agentExecutions?: ReadonlyMap<string, AgentExecution>;
  columnLimits?: Readonly<Record<string, number>>;
  onChangeLimit?: (status: WorkflowStatusName, limit: number | null) => void;
  onGroupIssue: (memberIdentifier: string, leadIdentifier: string) => Promise<void> | void;
  onUngroupIssue: (identifier: string) => Promise<void> | void;
}

export function BoardView({
  board,
  statuses,
  workflowStatuses,
  projectSlug,
  onIssueCreated,
  onSelectIssue,
  onMoveIssue,
  collapsedStatuses,
  onToggleCollapse,
  agentExecutions,
  columnLimits,
  onChangeLimit,
  onGroupIssue,
  onUngroupIssue,
}: BoardViewProps) {
  const [activeIdentifier, setActiveIdentifier] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  // Refs mirror the drag state so the move handler can read/compare
  // synchronously across the rapid event burst dnd-kit emits, committing a
  // render only when the resolved target actually changes.
  const mergeTargetRef = useRef<string | null>(null);
  const dropIndicatorRef = useRef<DropIndicator | null>(null);

  function commitMergeTarget(next: string | null) {
    if (mergeTargetRef.current === next) return;
    mergeTargetRef.current = next;
    setMergeTargetId(next);
  }

  function commitDropIndicator(next: DropIndicator | null) {
    const current = dropIndicatorRef.current;
    if (current?.unitId === next?.unitId && current?.edge === next?.edge) return;
    dropIndicatorRef.current = next;
    setDropIndicator(next);
  }

  function resetDragState() {
    mergeTargetRef.current = null;
    dropIndicatorRef.current = null;
    setActiveIdentifier(null);
    setMergeTargetId(null);
    setDropIndicator(null);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  );
  const statusNames = useMemo(() => workflowStatusNames(statuses ?? Object.keys(board)), [board, statuses]);

  const categoryByName = useMemo(() => {
    const map = new Map<string, WorkflowStatusCategory>();
    for (const status of workflowStatuses ?? []) map.set(status.name, status.category);
    return map;
  }, [workflowStatuses]);

  const activeIssue = useMemo(() => {
    if (!activeIdentifier) return null;
    return statusNames
      .flatMap((status) => board[status] ?? [])
      .find((issue) => issue.identifier === activeIdentifier);
  }, [activeIdentifier, board, statusNames]);

  function handleDragStart(event: DragStartEvent) {
    mergeTargetRef.current = null;
    dropIndicatorRef.current = null;
    setActiveIdentifier(parseDragIssueId(event.active.id));
  }

  // Cards do not reflow during a drag (see the no-op sorting strategy), so the
  // pointer always sits over the card the user is aiming at. Re-evaluated on
  // every move (onDragMove), the pointer's depth within that card decides the
  // intent: middle band = group, top/bottom edge = reorder before/after.
  function handleDragMove(event: DragMoveEvent | DragOverEvent) {
    const identifier = parseDragIssueId(event.active.id);
    if (!identifier || !event.over) {
      commitMergeTarget(null);
      commitDropIndicator(null);
      return;
    }

    const overId = String(event.over.id);
    const overIsUnit = overId.startsWith(ISSUE_DRAG_PREFIX) || overId.startsWith(GROUP_DRAG_PREFIX);
    const overIsOtherUnit = overIsUnit && overId !== String(event.active.id);
    const pointerY = dragPointerY(event);

    if (!overIsOtherUnit || event.over.rect == null || pointerY == null) {
      commitMergeTarget(null);
      commitDropIndicator(null);
      return;
    }

    // Wider keep-band while already merging this target adds hysteresis so a
    // tiny wobble near the edge can't flip between grouping and reordering.
    const edgeRatio = mergeTargetRef.current === overId ? MERGE_EXIT_EDGE_RATIO : MERGE_ENTER_EDGE_RATIO;

    if (mergeIntent(pointerY, event.over.rect, edgeRatio)) {
      commitMergeTarget(overId);
      commitDropIndicator(null);
      return;
    }

    commitMergeTarget(null);
    const overMidpoint = event.over.rect.top + event.over.rect.height / 2;
    commitDropIndicator({ unitId: overId, edge: pointerY < overMidpoint ? "top" : "bottom" });
  }

  function handleDragEnd(event: DragEndEvent) {
    const wasMergeTarget = mergeTargetRef.current;
    resetDragState();

    const identifier = parseDragIssueId(event.active.id);
    if (!identifier || !event.over) return;

    if (wasMergeTarget) {
      const leadIdentifier = wasMergeTarget.startsWith(GROUP_DRAG_PREFIX)
        ? wasMergeTarget.slice(GROUP_DRAG_PREFIX.length)
        : parseDragIssueId(wasMergeTarget);
      if (leadIdentifier && leadIdentifier !== identifier) {
        void onGroupIssue(identifier, leadIdentifier);
        return;
      }
    }

    const resolved = resolveBoardMove(board, identifier, String(event.over.id), statusNames);
    const move = resolved ? { targetStatus: resolved.targetStatus, targetIndex: resolved.targetIndex } : null;
    if (!move) return;

    void onMoveIssue(identifier, move.targetStatus, move.targetIndex);
  }

  function handleDragCancel(_event: DragCancelEvent) {
    resetDragState();
  }

  function handleDisband(leadIdentifier: string) {
    const lead = statusNames
      .flatMap((status) => board[status] ?? [])
      .find((issue) => issue.identifier === leadIdentifier);
    for (const memberIdentifier of lead?.groupMemberIdentifiers ?? []) void onUngroupIssue(memberIdentifier);
  }

  useEffect(() => {
    const scroller = boardRef.current;
    if (!scroller) return;

    function onWheel(event: WheelEvent) {
      const el = boardRef.current;
      if (!el || el.scrollWidth <= el.clientWidth) return;

      // Trackpad / mouse horizontal tilt — let the browser handle it.
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

      const columnBody = (event.target as HTMLElement).closest("[data-board-column-scroll]");
      if (columnBody instanceof HTMLElement) {
        const canScrollVertical = columnBody.scrollHeight > columnBody.clientHeight + 1;
        if (canScrollVertical && !event.shiftKey) return;
      }

      el.scrollLeft += event.deltaY;
      event.preventDefault();
    }

    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollisionDetection}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        ref={boardRef}
        className="scrollbar-discrete flex h-[calc(100vh-7.25rem)] w-full min-w-0 gap-3 overflow-x-auto px-6 pb-3 pt-5"
      >
        {statusNames.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            category={categoryByName.get(status) ?? null}
            issues={board[status] ?? []}
            onSelectIssue={onSelectIssue}
            projectSlug={projectSlug}
            statuses={statusNames}
            onIssueCreated={onIssueCreated}
            collapsed={collapsedStatuses.has(status)}
            onToggleCollapse={() => onToggleCollapse(status)}
            agentExecutions={agentExecutions}
            limit={columnLimits?.[status]}
            onChangeLimit={onChangeLimit}
            dragActive={activeIdentifier !== null}
            onRemoveMember={onUngroupIssue}
            onDisband={handleDisband}
            mergeTargetId={mergeTargetId}
            dropIndicator={dropIndicator}
          />
        ))}
      </div>
      <DragOverlay>
        {activeIssue ? (
          // Dim the floating card while it is over a group target so the
          // target's "drop to group" affordance underneath stays readable.
          <div className={mergeTargetId ? "opacity-50 transition-opacity" : "transition-opacity"}>
            <IssueCard
              issue={activeIssue}
              onSelect={onSelectIssue}
              agent={agentExecutions?.get(activeIssue.identifier)}
              dragOverlay
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
