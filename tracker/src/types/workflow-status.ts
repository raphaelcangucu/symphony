export type WorkflowStatusName = string;

export type WorkflowStatusCategory = "backlog" | "unstarted" | "started" | "completed" | "canceled" | "active" | "wait" | "terminal";

export interface WorkflowStatus {
  id: string;
  name: WorkflowStatusName;
  category: WorkflowStatusCategory;
  position: number;
  isTerminal: boolean;
}
