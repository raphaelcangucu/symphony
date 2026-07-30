import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type { ProjectSessionRow, TrackerClient } from "@/api/contracts";

import { buildSessionTree, type SessionTreeGroup } from "./session-tree";

type UseSessionLibraryOptions = {
  client: TrackerClient;
  profileId: string;
  query: string;
  collapsedProjectSlugs: Set<string>;
};

type SessionLibraryResult = {
  groups: SessionTreeGroup[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  viewerName: string | null;
  refresh(): Promise<void>;
};

export function useSessionLibrary({
  client,
  profileId,
  query,
  collapsedProjectSlugs,
}: UseSessionLibraryOptions): SessionLibraryResult {
  const viewerQuery = useQuery({
    queryKey: ["host", profileId, "session-library", "viewer"],
    queryFn: ({ signal }) => client.viewer(signal),
  });
  const projectsQuery = useQuery({
    queryKey: ["host", profileId, "session-library", "projects"],
    queryFn: ({ signal }) => client.projects(signal),
  });
  const threadsQuery = useQuery({
    queryKey: ["host", profileId, "session-library", "threads"],
    queryFn: ({ signal }) =>
      client.threads(
        {
          scopes: ["freeform", "project_session", "issue_session"],
          limit: 100,
        },
        signal,
      ),
  });
  const sessionQueries = useQueries({
    queries: (projectsQuery.data ?? []).map((project) => ({
      queryKey: ["host", profileId, "session-library", "project-sessions", project.slug],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        client.projectSessions(project.slug, { limit: 50 }, signal),
    })),
  });

  const projectSessions = useMemo<Record<string, ProjectSessionRow[]>>(
    () =>
      Object.fromEntries(
        (projectsQuery.data ?? []).map((project, index) => [
          project.slug,
          sessionQueries[index]?.data?.sessions ?? [],
        ]),
      ),
    [projectsQuery.data, sessionQueries],
  );
  const groups = useMemo(
    () =>
      buildSessionTree({
        projects: projectsQuery.data ?? [],
        threads: threadsQuery.data ?? [],
        projectSessions,
        query,
        collapsedProjectSlugs,
        includeArchived: false,
      }),
    [collapsedProjectSlugs, projectSessions, projectsQuery.data, query, threadsQuery.data],
  );
  const firstError =
    projectsQuery.error ??
    threadsQuery.error ??
    sessionQueries.find((sessionQuery) => sessionQuery.error)?.error ??
    null;
  const loading =
    viewerQuery.isPending ||
    projectsQuery.isPending ||
    threadsQuery.isPending ||
    sessionQueries.some((sessionQuery) => sessionQuery.isPending);
  const refreshing =
    !loading &&
    (viewerQuery.isFetching ||
      projectsQuery.isFetching ||
      threadsQuery.isFetching ||
      sessionQueries.some((sessionQuery) => sessionQuery.isFetching));
  const refresh = useCallback(async () => {
    const requests: Promise<unknown>[] = [
      viewerQuery.refetch(),
      projectsQuery.refetch(),
      threadsQuery.refetch(),
      ...sessionQueries.map((sessionQuery) => sessionQuery.refetch()),
    ];
    await Promise.all(requests);
  }, [projectsQuery, sessionQueries, threadsQuery, viewerQuery]);

  return {
    groups,
    loading,
    refreshing,
    error: errorMessage(firstError),
    viewerName: viewerQuery.data?.name ?? null,
    refresh,
  };
}

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : "Could not load sessions";
}
