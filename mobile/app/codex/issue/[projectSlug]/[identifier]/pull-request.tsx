import { ConnectionGate } from "@/features/connect/ConnectionGate";
import { PullRequestRoute } from "@/features/pull-requests/PullRequestRoute";

export default function PullRequestPage() {
  return (
    <ConnectionGate>
      <PullRequestRoute />
    </ConnectionGate>
  );
}
