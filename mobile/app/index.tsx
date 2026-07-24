import { ConnectionGate } from "@/features/connect/ConnectionGate";
import { SessionLibraryRoute } from "@/features/sessions/SessionLibraryRoute";

export default function IndexRoute() {
  return (
    <ConnectionGate>
      <SessionLibraryRoute />
    </ConnectionGate>
  );
}
