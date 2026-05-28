export type WorkflowStatusName =
  | "Backlog"
  | "Todo"
  | "In Progress"
  | "Human Review"
  | "Merging"
  | "Rework"
  | "Done";

export type WorkflowStatusCategory = "backlog" | "unstarted" | "started" | "completed" | "canceled" | "active";

export interface WorkflowStatus {
  id: string;
  name: WorkflowStatusName;
  category: WorkflowStatusCategory;
  position: number;
  isTerminal: boolean;
}
