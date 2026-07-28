import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";

import { CreateTaskScreen, type CreateTaskSubmission } from "./CreateTaskScreen";

export function CreateTaskRoute() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const client = useTrackerClient();
  const { activeProfile } = useConnection();
  const hostId = activeProfile?.hostId ?? activeProfile?.id;
  const [projectSlug, setProjectSlug] = useState<string | null>(null);
  const projectsQuery = useQuery({
    queryKey: ["host", hostId, "task-create-projects"],
    enabled: Boolean(client && activeProfile),
    queryFn: ({ signal }) => client!.projects(signal),
  });
  useEffect(() => {
    if (!projectSlug && projectsQuery.data?.[0]) setProjectSlug(projectsQuery.data[0].slug);
  }, [projectSlug, projectsQuery.data]);
  const optionsQuery = useQuery({
    queryKey: ["host", hostId, "task-create-options", projectSlug],
    enabled: Boolean(client && activeProfile && projectSlug),
    queryFn: ({ signal }) => client!.issueFormOptions(projectSlug!, signal),
  });
  const catalogQuery = useQuery({
    queryKey: ["host", hostId, "task-create-catalog", projectSlug],
    enabled: Boolean(client && activeProfile && projectSlug),
    queryFn: ({ signal }) => client!.assistantCatalog(projectSlug!, signal),
  });
  const createMutation = useMutation({
    mutationFn: async (input: CreateTaskSubmission) => {
      if (!client || !projectSlug) throw new Error("Select a project");
      return client.createIssue(projectSlug, input);
    },
    onSuccess: async (issue) => {
      await queryClient.invalidateQueries({ queryKey: ["host", hostId, "tasks"] });
      router.replace(
        `/codex/issue/${encodeURIComponent(issue.projectSlug)}/${encodeURIComponent(issue.identifier)}`,
      );
    },
  });
  const error =
    projectsQuery.error ?? optionsQuery.error ?? catalogQuery.error ?? createMutation.error;

  return (
    <CreateTaskScreen
      catalog={catalogQuery.data ?? null}
      error={error instanceof Error ? error.message : null}
      initialAgent={optionsQuery.data?.effectiveAgent ?? "codex"}
      loading={projectsQuery.isLoading || optionsQuery.isLoading || catalogQuery.isLoading}
      onBack={() => router.back()}
      onProjectChange={setProjectSlug}
      onSubmit={createMutation.mutate}
      projectSlug={projectSlug}
      projects={projectsQuery.data ?? []}
      statuses={optionsQuery.data?.statuses ?? []}
      submitting={createMutation.isPending}
    />
  );
}
