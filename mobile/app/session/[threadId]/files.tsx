import { ConnectionGate } from "@/features/connect/ConnectionGate";
import { FilesRoute } from "@/features/workspace/FilesRoute";

export default function FilesPage() {
  return (
    <ConnectionGate>
      <FilesRoute />
    </ConnectionGate>
  );
}
