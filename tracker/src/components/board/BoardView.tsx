import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  type DragCancelEvent,
  type DragEndEvent,
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
  findIssueStatus,
  mergeIntent,
  parseDragIssueId,
  resolveBoardMove,
  workflowStatusNames,
  GROUP_DRAG_PREFIX,
  ISSUE_DRAG_PREFIX,
  type BoardState,
} from "./board-utils";
import { IssueCard } from "./IssueCard";

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
  const [previewBoard, setPreviewBoard] = useState<typeof board | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const displayBoard = previewBoard ?? board;
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
      .flatMap((status) => displayBoard[status] ?? [])
      .find((issue) => issue.identifier === activeIdentifier);
  }, [activeIdentifier, displayBoard, statusNames]);

  function handleDragStart(event: DragStartEvent) {
    setActiveIdentifier(parseDragIssueId(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const identifier = parseDragIssueId(event.active.id);
    if (!identifier || !event.over) {
      setMergeTargetId(null);
      return;
    }

    const overId = String(event.over.id);
    const overIsUnit = overId.startsWith(ISSUE_DRAG_PREFIX) || overId.startsWith(GROUP_DRAG_PREFIX);
    const activeRect = event.active.rect.current.translated;
    const merge =
      overIsUnit && overId !== String(event.active.id) && activeRect != null && event.over.rect != null
        ? mergeIntent(activeRect, event.over.rect, 0.25)
        : false;

    setMergeTargetId(merge ? overId : null);

    if (merge) {
      setPreviewBoard(null);
      return;
    }

    const resolved = resolveBoardMove(board, identifier, overId, statusNames);
    if (resolved) setPreviewBoard(resolved.board);
  }

  function resolveDropTarget(
    identifier: string,
    overId: string,
    preview: BoardState | null,
  ): { targetStatus: WorkflowStatusName; targetIndex: number } | null {
    // When releasing over the dragged card itself (its previewed slot — e.g. the
    // top of an empty target column), the live preview already reflects the
    // intended destination. Commit that instead of re-resolving against the real
    // board, which would resolve back to the source column and drop nothing.
    if (preview && parseDragIssueId(overId) === identifier) {
      const targetStatus = findIssueStatus(preview, identifier, statusNames);
      if (!targetStatus) return null;

      const targetIndex = preview[targetStatus].findIndex((issue) => issue.identifier === identifier);
      if (targetIndex < 0) return null;

      const sourceStatus = findIssueStatus(board, identifier, statusNames);
      const sourceIndex = sourceStatus
        ? board[sourceStatus].findIndex((issue) => issue.identifier === identifier)
        : -1;
      if (sourceStatus === targetStatus && sourceIndex === targetIndex) return null;

      return { targetStatus, targetIndex };
    }

    const resolved = resolveBoardMove(board, identifier, overId, statusNames);
    return resolved ? { targetStatus: resolved.targetStatus, targetIndex: resolved.targetIndex } : null;
  }

  function handleDragEnd(event: DragEndEvent) {
    const preview = previewBoard;
    const wasMergeTarget = mergeTargetId;
    setPreviewBoard(null);
    setActiveIdentifier(null);
    setMergeTargetId(null);

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

    const move = resolveDropTarget(identifier, String(event.over.id), preview);
    if (!move) return;

    void onMoveIssue(identifier, move.targetStatus, move.targetIndex);
  }

  function handleDragCancel(_event: DragCancelEvent) {
    setPreviewBoard(null);
    setActiveIdentifier(null);
    setMergeTargetId(null);
  }

  function handleDisband(leadIdentifier: string) {
    const lead = statusNames
      .flatMap((status) => displayBoard[status] ?? [])
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
      onDragOver={handleDragOver}
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
            issues={displayBoard[status] ?? []}
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
          />
        ))}
      </div>
      <DragOverlay>
        {activeIssue ? (
          <IssueCard
            issue={activeIssue}
            onSelect={onSelectIssue}
            agent={agentExecutions?.get(activeIssue.identifier)}
            dragOverlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
