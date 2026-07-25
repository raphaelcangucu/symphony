import { ConnectionGate } from "@/features/connect/ConnectionGate";
import { DiffRoute } from "@/features/source-control/DiffRoute";

export default function DiffPage() {
  return (
    <ConnectionGate>
      <DiffRoute />
    </ConnectionGate>
  );
}
