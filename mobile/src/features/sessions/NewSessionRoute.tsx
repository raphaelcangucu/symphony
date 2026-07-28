import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";
import { StateView } from "@/components/StateView";
import { useAppRuntime } from "@/runtime/AppRuntime";

import { NewSessionScreen } from "./NewSessionScreen";
import { createInitialNewSessionState, type NewSessionState } from "./new-session-state";

const DRAFT_KEY_PREFIX = "symphony.new-session.draft";

export function NewSessionRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    projectSlug?: string | string[];
    issueIdentifier?: string | string[];
    agentKind?: string | string[];
    model?: string | string[];
    effort?: string | string[];
  }>();
  const taskPrefill = {
    projectSlug: routeParam(params.projectSlug),
    issueIdentifier: routeParam(params.issueIdentifier),
    agentKind: routeParam(params.agentKind),
    model: routeParam(params.model),
    effort: routeParam(params.effort),
  };
  const client = useTrackerClient();
  const { dictate } = useAppRuntime();
  const { activeProfile } = useConnection();
  const profileId = activeProfile?.hostId ?? activeProfile?.id ?? null;
  const [draft, setDraft] = useState<NewSessionState | null>(null);
  const projectsQuery = useQuery({
    queryKey: ["host", profileId, "new-session", "projects"],
    enabled: Boolean(client && profileId),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("No active connection");
      return client.projects(signal);
    },
  });

  useEffect(() => {
    let cancelled = false;
    if (!profileId) {
      setDraft(null);
      return () => {
        cancelled = true;
      };
    }
    void AsyncStorage.getItem(draftStorageKey(profileId)).then((value) => {
      if (!cancelled) setDraft(prefillTask(parseDraft(value), taskPrefill));
    });
    return () => {
      cancelled = true;
    };
  }, [
    profileId,
    taskPrefill.agentKind,
    taskPrefill.effort,
    taskPrefill.issueIdentifier,
    taskPrefill.model,
    taskPrefill.projectSlug,
  ]);

  const persistDraft = useCallback(
    (state: NewSessionState) => {
      if (!profileId) return;
      void AsyncStorage.setItem(draftStorageKey(profileId), JSON.stringify(state));
    },
    [profileId],
  );
  if (!client || !activeProfile) return null;
  if (!draft || projectsQuery.isPending) {
    return <StateView kind="loading" title="Preparing a new chat" />;
  }
  if (projectsQuery.error) {
    return (
      <StateView
        actionLabel="Retry"
        description={errorMessage(projectsQuery.error)}
        kind="error"
        onAction={() => void projectsQuery.refetch()}
        title="Could not load projects"
      />
    );
  }

  return (
    <NewSessionScreen
      connectionName={activeProfile.name}
      createThread={(input) => client.createThread(input)}
      initialState={draft}
      loadCatalog={(projectSlug) => client.assistantCatalog(projectSlug)}
      onBack={() => router.back()}
      onCreated={(threadId, prompt) =>
        router.replace(`/codex/session/${threadId}?seed=${encodeURIComponent(prompt)}`)
      }
      onDictate={() => dictate(resolvedLocale())}
      onDraftChange={persistDraft}
      projects={projectsQuery.data ?? []}
    />
  );
}

function draftStorageKey(profileId: string): string {
  return `${DRAFT_KEY_PREFIX}.${profileId}`;
}

function parseDraft(value: string | null): NewSessionState {
  if (!value) return createInitialNewSessionState();
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return createInitialNewSessionState();
    const initial = createInitialNewSessionState();
    return {
      ...initial,
      requestKey:
        typeof parsed.requestKey === "string" && parsed.requestKey.trim()
          ? parsed.requestKey
          : initial.requestKey,
      prompt: typeof parsed.prompt === "string" ? parsed.prompt : "",
      scope: parsed.scope === "project" ? "project" : "free",
      projectSlug: optionalString(parsed.projectSlug),
      workspaceMode: isWorkspaceMode(parsed.workspaceMode) ? parsed.workspaceMode : "default",
      workspacePath: optionalString(parsed.workspacePath),
      issueIdentifier: optionalString(parsed.issueIdentifier),
      branch: optionalString(parsed.branch),
      agentKind: isAgentKind(parsed.agentKind) ? parsed.agentKind : "codex",
      model: optionalString(parsed.model),
      effort: optionalString(parsed.effort),
    };
  } catch {
    return createInitialNewSessionState();
  }
}

function prefillTask(
  draft: NewSessionState,
  params: {
    projectSlug: string | null;
    issueIdentifier: string | null;
    agentKind: string | null;
    model: string | null;
    effort: string | null;
  },
): NewSessionState {
  const { projectSlug, issueIdentifier } = params;
  if (!projectSlug || !issueIdentifier) return draft;
  const { agentKind } = params;
  return {
    ...draft,
    scope: "project",
    projectSlug,
    issueIdentifier,
    workspaceMode: "isolated",
    agentKind: isAgentKind(agentKind) ? agentKind : draft.agentKind,
    model: params.model,
    effort: params.effort,
  };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isWorkspaceMode(value: unknown): value is NewSessionState["workspaceMode"] {
  return ["default", "existing", "isolated", "parent"].includes(String(value));
}

function isAgentKind(value: unknown): value is NewSessionState["agentKind"] {
  return ["codex", "claude", "cursor", "opencode"].includes(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function routeParam(value: string | string[] | undefined): string | null {
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved?.trim() || null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not load projects";
}

function resolvedLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en";
  } catch {
    return "en";
  }
}
