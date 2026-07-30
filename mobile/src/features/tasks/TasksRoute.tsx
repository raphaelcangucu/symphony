import { useRouter } from "expo-router";
import { useMemo, useState } from "react";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";

import { TasksScreen } from "./TasksScreen";
import { useTasks } from "./useTasks";

export function TasksRoute() {
  const router = useRouter();
  const client = useTrackerClient();
  const { activeProfile } = useConnection();
  const [query, setQuery] = useState("");
  const [activeStatus, setActiveStatus] = useState<string | null>(null);
  const filters = useMemo(
    () => ({
      query,
      projectSlugs: new Set<string>(),
      statuses: activeStatus ? new Set([activeStatus]) : new Set<string>(),
      priorities: new Set<0 | 1 | 2 | 3 | 4>(),
    }),
    [activeStatus, query],
  );

  if (!client || !activeProfile) return null;
  return (
    <ConnectedTasksRoute
      activeStatus={activeStatus}
      client={client}
      filters={filters}
      onActiveStatusChange={setActiveStatus}
      profileId={activeProfile.hostId ?? activeProfile.id}
      query={query}
      router={router}
      setQuery={setQuery}
    />
  );
}

function ConnectedTasksRoute({
  activeStatus,
  client,
  filters,
  onActiveStatusChange,
  profileId,
  query,
  router,
  setQuery,
}: {
  activeStatus: string | null;
  client: NonNullable<ReturnType<typeof useTrackerClient>>;
  filters: Parameters<typeof useTasks>[0]["filters"];
  onActiveStatusChange(status: string | null): void;
  profileId: string;
  query: string;
  router: ReturnType<typeof useRouter>;
  setQuery(query: string): void;
}) {
  const tasks = useTasks({ client, profileId, filters });
  return (
    <TasksScreen
      activeStatus={activeStatus}
      error={tasks.error}
      groups={tasks.groups}
      loading={tasks.loading || tasks.refreshing}
      onBack={() => router.back()}
      onCreateTask={() => router.push("/codex/tasks/new")}
      onOpenTask={(projectSlug, identifier) =>
        router.push(
          `/codex/issue/${encodeURIComponent(projectSlug)}/${encodeURIComponent(identifier)}`,
        )
      }
      onQueryChange={setQuery}
      onRefresh={() => void tasks.refresh()}
      onStatusChange={onActiveStatusChange}
      query={query}
      statuses={tasks.statuses}
    />
  );
}
