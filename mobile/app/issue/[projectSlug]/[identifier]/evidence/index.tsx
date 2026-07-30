import { ConnectionGate } from "@/features/connect/ConnectionGate";
import { TaskEvidenceRoute } from "@/features/evidence/TaskEvidenceRoute";

export default function TaskEvidencePage() {
  return (
    <ConnectionGate>
      <TaskEvidenceRoute />
    </ConnectionGate>
  );
}
