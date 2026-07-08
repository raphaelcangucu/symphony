import type { WorkflowStatus, WorkflowStatusCategory, WorkflowStatusName } from "@/types/workflow-status";

export type BackendId = string | number;

export interface BackendWorkflowStatusDto {
  id?: BackendId;
  name?: string | null;
  category?: string | null;
  position?: number | null;
  is_terminal?: boolean | null;
  isTerminal?: boolean | null;
}

export function normalizeStatusName(status: BackendWorkflowStatusDto | string | null | undefined): WorkflowStatusName {
  if (typeof status === "string") return status.trim() ? (status as WorkflowStatusName) : "Backlog";
  if (status && typeof status.name === "string" && status.name.trim()) {
    return status.name as WorkflowStatusName;
  }
  return "Backlog";
}

export function normalizeWorkflowStatus(dto: BackendWorkflowStatusDto): WorkflowStatus {
  return {
    id: maybeString(dto.id) ?? "",
    name: normalizeStatusName(dto.name ?? null),
    category: normalizeWorkflowStatusCategory(dto.category),
    position: dto.position ?? 0,
    isTerminal: dto.isTerminal ?? dto.is_terminal ?? false,
  };
}

function normalizeWorkflowStatusCategory(category: string | null | undefined): WorkflowStatusCategory {
  if (
    category === "backlog" ||
    category === "unstarted" ||
    category === "started" ||
    category === "completed" ||
    category === "canceled" ||
    category === "active" ||
    category === "wait" ||
    category === "terminal"
  ) {
    return category;
  }
  return "backlog";
}

export function maybeString(value: BackendId | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}
