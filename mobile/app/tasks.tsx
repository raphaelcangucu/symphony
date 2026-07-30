import { ConnectionGate } from "@/features/connect/ConnectionGate";
import { TasksRoute } from "@/features/tasks/TasksRoute";

export default function TasksPage() {
  return (
    <ConnectionGate>
      <TasksRoute />
    </ConnectionGate>
  );
}
