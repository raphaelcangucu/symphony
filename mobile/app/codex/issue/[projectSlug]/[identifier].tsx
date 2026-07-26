import { ConnectionGate } from "@/features/connect/ConnectionGate";
import { IssueRoute } from "@/features/tasks/IssueRoute";

export default function IssuePage() {
  return (
    <ConnectionGate>
      <IssueRoute />
    </ConnectionGate>
  );
}
