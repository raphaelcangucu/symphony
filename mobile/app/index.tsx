import { ConnectionGate } from "@/features/connect/ConnectionGate";
import { SessionLibraryRoute } from "@/features/sessions/SessionLibraryRoute";
import { OrcaHomeRoute } from "@/orca/routes/OrcaHomeRoute";
import { useViewMode } from "@/preferences/ViewModeProvider";

export default function IndexRoute() {
  const { hydrated, mode } = useViewMode();
  if (!hydrated) return null;
  if (mode === "orca") return <OrcaHomeRoute />;
  return (
    <ConnectionGate>
      <SessionLibraryRoute />
    </ConnectionGate>
  );
}
