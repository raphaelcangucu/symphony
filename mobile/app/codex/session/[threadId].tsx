import { ConnectionGate } from "@/features/connect/ConnectionGate";
import { SessionRoute } from "@/features/sessions/SessionRoute";

export default function SessionPage() {
  return (
    <ConnectionGate>
      <SessionRoute />
    </ConnectionGate>
  );
}
