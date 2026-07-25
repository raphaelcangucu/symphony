import { ConnectionGate } from "@/features/connect/ConnectionGate";
import { CreateTaskRoute } from "@/features/tasks/CreateTaskRoute";

export default function CreateTaskPage() {
  return (
    <ConnectionGate>
      <CreateTaskRoute />
    </ConnectionGate>
  );
}
