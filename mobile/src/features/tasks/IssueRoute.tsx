import { useLocalSearchParams, useRouter } from "expo-router";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";

import { IssueScreen } from "./IssueScreen";
import { useIssueDetail } from "./useIssueDetail";

export function IssueRoute() {
  const params = useLocalSearchParams<{ projectSlug?: string; identifier?: string }>();
  const router = useRouter();
  const client = useTrackerClient();
  const { activeProfile } = useConnection();
  const projectSlug = routeParam(params.projectSlug);
  const identifier = routeParam(params.identifier);

  if (!client || !activeProfile || !projectSlug || !identifier) return null;
  return (
    <ConnectedIssueRoute
      client={client}
      identifier={identifier}
      profileId={activeProfile.id}
      projectSlug={projectSlug}
      router={router}
    />
  );
}

function ConnectedIssueRoute({
  client,
  identifier,
  profileId,
  projectSlug,
  router,
}: {
  client: NonNullable<ReturnType<typeof useTrackerClient>>;
  identifier: string;
  profileId: string;
  projectSlug: string;
  router: ReturnType<typeof useRouter>;
}) {
  const detail = useIssueDetail({ client, profileId, projectSlug, identifier });
  const threadRoute = (suffix = "") => {
    if (detail.threadId) router.push(`/session/${detail.threadId}${suffix}`);
  };
  return (
    <IssueScreen
      blockers={detail.blockers}
      comments={detail.comments}
      dispatching={detail.dispatching}
      error={detail.error}
      issue={detail.issue}
      loading={detail.loading}
      onAddComment={detail.addComment}
      onBack={() => router.back()}
      onDispatch={detail.dispatch}
      onGoalAction={detail.goalAction}
      onOpenDiff={() => threadRoute("/diff")}
      onOpenFiles={() => threadRoute("/files")}
      onOpenPreview={() => threadRoute("/preview")}
      onOpenPullRequest={() =>
        router.push(
          `/issue/${encodeURIComponent(projectSlug)}/${encodeURIComponent(identifier)}/pull-request`,
        )
      }
      onOpenSession={() => threadRoute()}
      onOpenTerminal={() => threadRoute("/terminal")}
      onRefresh={() => void detail.refresh()}
      onSave={detail.save}
      saving={detail.saving}
    />
  );
}

function routeParam(value: string | string[] | undefined): string | null {
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved?.trim() || null;
}
