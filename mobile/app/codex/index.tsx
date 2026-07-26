import { Redirect } from "expo-router";

import { ConnectionGate } from "@/features/connect/ConnectionGate";
import { SessionLibraryRoute } from "@/features/sessions/SessionLibraryRoute";
import { useViewMode } from "@/preferences/ViewModeProvider";

export default function CompactSessionsPage() {
  const { hydrated, mode } = useViewMode();
  if (!hydrated) return null;
  if (mode !== "codex") return <Redirect href="/" />;
  return (
    <ConnectionGate>
      <SessionLibraryRoute />
    </ConnectionGate>
  );
}
