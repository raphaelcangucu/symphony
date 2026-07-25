import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";
import { useViewMode } from "@/preferences/ViewModeProvider";

import { SettingsScreen } from "./SettingsScreen";

export function SettingsRoute() {
  const router = useRouter();
  const client = useTrackerClient();
  const { activeProfile } = useConnection();
  const { mode, setMode } = useViewMode();
  const profileId = activeProfile?.hostId ?? activeProfile?.id ?? null;
  const availability = useQuery({
    queryKey: ["host", profileId, "settings", "agent-availability"],
    enabled: Boolean(client && profileId),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("No active connection");
      return client.agentAvailability(signal);
    },
  });
  const usage = useQuery({
    queryKey: ["host", profileId, "settings", "agent-usage"],
    enabled: Boolean(client && profileId),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("No active connection");
      return client.agentUsage(signal);
    },
  });
  const error = availability.error ?? usage.error;

  return (
    <SettingsScreen
      availability={availability.data ?? {}}
      error={error ? errorMessage(error) : null}
      loading={availability.isPending || usage.isPending}
      onBack={() => router.back()}
      onChangeViewMode={(nextMode) => {
        void setMode(nextMode).then(() => router.replace("/"));
      }}
      onOpenDiagnostics={() => router.push("/diagnostics")}
      onOpenNotifications={() => router.push("/notifications")}
      onRefresh={() => {
        void availability.refetch();
        void usage.refetch();
      }}
      usage={usage.data ?? {}}
      viewMode={mode}
    />
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not load settings";
}
