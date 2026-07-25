import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";

import { SettingsScreen } from "./SettingsScreen";

export function SettingsRoute() {
  const router = useRouter();
  const client = useTrackerClient();
  const { activeProfile } = useConnection();
  const profileId = activeProfile?.id ?? null;
  const availability = useQuery({
    queryKey: ["settings", profileId, "agent-availability"],
    enabled: Boolean(client && profileId),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("No active connection");
      return client.agentAvailability(signal);
    },
  });
  const usage = useQuery({
    queryKey: ["settings", profileId, "agent-usage"],
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
      onOpenDiagnostics={() => router.push("/diagnostics")}
      onOpenNotifications={() => router.push("/notifications")}
      onRefresh={() => {
        void availability.refetch();
        void usage.refetch();
      }}
      usage={usage.data ?? {}}
    />
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not load settings";
}
