export type AgentTaskStatus = "pending" | "in_progress" | "completed";

export type AgentTaskSource = "plan" | "todo" | "task";

export interface AgentTask {
  id: string;
  text: string;
  status: AgentTaskStatus;
  source: AgentTaskSource;
}

export interface AgentTaskSnapshot {
  source: AgentTaskSource;
  tasks: AgentTask[];
  explanation?: string;
}
