import { ConnectionGate } from "@/features/connect/ConnectionGate";
import { ComparisonRoute } from "@/features/comparisons/ComparisonRoute";

export default function ComparisonPage() {
  return (
    <ConnectionGate>
      <ComparisonRoute />
    </ConnectionGate>
  );
}
