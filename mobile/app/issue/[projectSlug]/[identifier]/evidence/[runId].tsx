import { ConnectionGate } from "@/features/connect/ConnectionGate";
import { EvidenceArtifactRoute } from "@/features/evidence/EvidenceArtifactRoute";

export default function EvidenceArtifactPage() {
  return (
    <ConnectionGate>
      <EvidenceArtifactRoute />
    </ConnectionGate>
  );
}
