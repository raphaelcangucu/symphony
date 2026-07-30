import { ConnectionGate } from "@/features/connect/ConnectionGate";
import { PreviewRoute } from "@/features/workspace/PreviewRoute";

export default function PreviewPage() {
  return (
    <ConnectionGate>
      <PreviewRoute />
    </ConnectionGate>
  );
}
