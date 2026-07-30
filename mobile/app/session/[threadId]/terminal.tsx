import { ConnectionGate } from "@/features/connect/ConnectionGate";
import { TerminalRoute } from "@/features/workspace/TerminalRoute";

export default function TerminalPage() {
  return (
    <ConnectionGate>
      <TerminalRoute />
    </ConnectionGate>
  );
}
