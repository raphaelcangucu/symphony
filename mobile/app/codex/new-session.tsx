import { ConnectionGate } from "@/features/connect/ConnectionGate";
import { NewSessionRoute } from "@/features/sessions/NewSessionRoute";

export default function NewSessionPage() {
  return (
    <ConnectionGate>
      <NewSessionRoute />
    </ConnectionGate>
  );
}
