import { Redirect } from "expo-router";

import { OrcaHomeRoute } from "@/orca/routes/OrcaHomeRoute";
import { useViewMode } from "@/preferences/ViewModeProvider";

export default function IndexRoute() {
  const { hydrated, mode } = useViewMode();
  if (!hydrated) return null;
  if (mode === "orca") return <OrcaHomeRoute />;
  return <Redirect href="/codex" />;
}
