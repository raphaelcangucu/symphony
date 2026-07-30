import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { TrackerClient } from "@/api/contracts";

import { filterAndGroupTasks, type TaskFilters } from "./task-filters";

export function useTasks({
  client,
  profileId,
  filters,
}: {
  client: TrackerClient;
  profileId: string;
  filters: TaskFilters;
}) {
  const query = useQuery({
    queryKey: ["host", profileId, "tasks"],
    queryFn: async ({ signal }) => {
      const projects = await client.projects(signal);
      const issues = await Promise.all(
        projects.map((project) => client.issues(project.slug, {}, signal)),
      );
      return issues.flat();
    },
  });
  const statuses = useMemo(
    () => [...new Set((query.data ?? []).map((issue) => issue.status))],
    [query.data],
  );
  const groups = useMemo(
    () =>
      filterAndGroupTasks(query.data ?? [], {
        ...filters,
        statusOrder: filters.statusOrder ?? statuses,
      }),
    [filters, query.data, statuses],
  );

  return {
    groups,
    statuses,
    loading: query.isLoading,
    refreshing: query.isFetching && !query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refresh: query.refetch,
  };
}
