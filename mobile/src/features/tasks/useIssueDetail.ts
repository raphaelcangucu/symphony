import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  GoalControlInput,
  IssueDispatchInput,
  IssueMutationInput,
  TrackerClient,
} from "@/api/contracts";

export function useIssueDetail({
  client,
  profileId,
  projectSlug,
  identifier,
}: {
  client: TrackerClient;
  profileId: string;
  projectSlug: string;
  identifier: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["host", profileId, "issue-detail", projectSlug, identifier] as const;
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const [issue, comments, blockers, subtasks, threads] = await Promise.all([
        client.issue(projectSlug, identifier, signal),
        client.comments(projectSlug, identifier, signal),
        client.blockers(projectSlug, identifier, signal),
        client.subtasks(projectSlug, identifier, signal),
        client.threads({ projectSlug, issueIdentifier: identifier, limit: 20 }, signal),
      ]);
      return {
        issue,
        comments,
        blockers,
        subtasks,
        threadId: threads[0]?.id ?? null,
      };
    },
  });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: ["host", profileId, "tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["host", profileId, "session-library"] }),
    ]);
  };
  const saveMutation = useMutation({
    mutationFn: (input: IssueMutationInput) => client.updateIssue(projectSlug, identifier, input),
    onSuccess: invalidate,
  });
  const commentMutation = useMutation({
    mutationFn: (body: string) => client.createComment(projectSlug, identifier, body),
    onSuccess: invalidate,
  });
  const subtaskMutation = useMutation({
    mutationFn: (title: string) =>
      client.createSubtask(projectSlug, identifier, {
        title,
        status: query.data?.issue.status ?? "Todo",
      }),
    onSuccess: invalidate,
  });
  const dispatchMutation = useMutation({
    mutationFn: (action: IssueDispatchInput["action"]) =>
      client.dispatchIssue(projectSlug, identifier, { action }),
    onSuccess: invalidate,
  });
  const goalMutation = useMutation({
    mutationFn: (action: GoalControlInput["action"]) =>
      client.goalControl(projectSlug, identifier, { action }),
    onSuccess: invalidate,
  });
  const mutationError =
    saveMutation.error ??
    commentMutation.error ??
    subtaskMutation.error ??
    dispatchMutation.error ??
    goalMutation.error;

  return {
    issue: query.data?.issue ?? null,
    comments: query.data?.comments ?? [],
    blockers: query.data?.blockers ?? [],
    subtasks: query.data?.subtasks ?? [],
    threadId: query.data?.threadId ?? null,
    loading: query.isLoading,
    error:
      (mutationError instanceof Error ? mutationError.message : null) ??
      (query.error instanceof Error ? query.error.message : null),
    saving: saveMutation.isPending || commentMutation.isPending || subtaskMutation.isPending,
    dispatching: dispatchMutation.isPending || goalMutation.isPending,
    addComment: commentMutation.mutate,
    createSubtask: subtaskMutation.mutate,
    dispatch: dispatchMutation.mutate,
    goalAction: goalMutation.mutate,
    refresh: query.refetch,
    save: saveMutation.mutate,
  };
}
