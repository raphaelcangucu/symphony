import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";

import { CreateTaskScreen } from "./CreateTaskScreen";

export function CreateTaskRoute() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const client = useTrackerClient();
  const { activeProfile } = useConnection();
  const [projectSlug, setProjectSlug] = useState<string | null>(null);
  const projectsQuery = useQuery({
    queryKey: ["task-create-projects", activeProfile?.id],
    enabled: Boolean(client && activeProfile),
    queryFn: ({ signal }) => client!.projects(signal),
  });
  useEffect(() => {
    if (!projectSlug && projectsQuery.data?.[0]) setProjectSlug(projectsQuery.data[0].slug);
  }, [projectSlug, projectsQuery.data]);
  const optionsQuery = useQuery({
    queryKey: ["task-create-options", activeProfile?.id, projectSlug],
    enabled: Boolean(client && activeProfile && projectSlug),
    queryFn: ({ signal }) => client!.issueFormOptions(projectSlug!, signal),
  });
  const createMutation = useMutation({
    mutationFn: async (input: Parameters<NonNullable<typeof client>["createIssue"]>[1]) => {
      if (!client || !projectSlug) throw new Error("Select a project");
      return client.createIssue(projectSlug, input);
    },
    onSuccess: async (issue) => {
      await queryClient.invalidateQueries({ queryKey: ["tasks", activeProfile?.id] });
      router.replace(
        `/issue/${encodeURIComponent(issue.projectSlug)}/${encodeURIComponent(issue.identifier)}`,
      );
    },
  });
  const error = projectsQuery.error ?? optionsQuery.error ?? createMutation.error;

  return (
    <CreateTaskScreen
      error={error instanceof Error ? error.message : null}
      initialAgent={optionsQuery.data?.effectiveAgent ?? "codex"}
      loading={projectsQuery.isLoading || optionsQuery.isLoading}
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
