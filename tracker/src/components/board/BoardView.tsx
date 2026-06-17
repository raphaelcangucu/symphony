import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCorners,
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
import { parseDragIssueId, resolveBoardMove, workflowStatusNames, type BoardState } from "./board-utils";
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
}: BoardViewProps) {
  const [activeIdentifier, setActiveIdentifier] = useState<string | null>(null);
  const [previewBoard, setPreviewBoard] = useState<typeof board | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const displayBoard = previewBoard ?? board;
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor));
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
    if (!identifier || !event.over) return;

    const resolved = resolveBoardMove(board, identifier, String(event.over.id), statusNames);
    if (resolved) setPreviewBoard(resolved.board);
  }

  function handleDragEnd(event: DragEndEvent) {
    setPreviewBoard(null);
    setActiveIdentifier(null);

    const identifier = parseDragIssueId(event.active.id);
    if (!identifier || !event.over) return;

    const resolved = resolveBoardMove(board, identifier, String(event.over.id), statusNames);
    if (!resolved) return;

    void onMoveIssue(identifier, resolved.targetStatus, resolved.targetIndex);
  }

  function handleDragCancel(_event: DragCancelEvent) {
    setPreviewBoard(null);
    setActiveIdentifier(null);
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
      collisionDetection={closestCorners}
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
