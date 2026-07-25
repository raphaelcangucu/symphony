import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";

import { SessionLibraryScreen } from "./SessionLibraryScreen";
import { useSessionLibrary } from "./useSessionLibrary";

const COLLAPSED_KEY_PREFIX = "symphony.session-library.collapsed";

export function SessionLibraryRoute() {
  const router = useRouter();
  const client = useTrackerClient();
  const { activeProfile } = useConnection();
  const [query, setQuery] = useState("");
  const hostId = activeProfile?.hostId ?? activeProfile?.id ?? null;
  const [collapsed, setCollapsed] = useCollapsedProjects(hostId);

  if (!client || !activeProfile) return null;

  return (
    <ConnectedSessionLibrary
      client={client}
      collapsed={collapsed}
      connectionName={activeProfile.name}
      onCollapsedChange={setCollapsed}
      onNewChat={() => router.push("/new-session")}
      onOpenConnections={() => router.push("/connections")}
      onOpenDiagnostics={() => router.push("/diagnostics")}
      onOpenNotifications={() => router.push("/notifications")}
      onOpenSettings={() => router.push("/settings")}
      onOpenTasks={() => router.push("/tasks")}
      onOpenSession={(threadId) => router.push(`/session/${threadId}`)}
      onQueryChange={setQuery}
      profileId={hostId ?? activeProfile.id}
      query={query}
    />
  );
}

function ConnectedSessionLibrary({
  client,
  collapsed,
  connectionName,
  onCollapsedChange,
  onNewChat,
  onOpenConnections,
  onOpenDiagnostics,
  onOpenNotifications,
  onOpenSettings,
  onOpenTasks,
  onOpenSession,
  onQueryChange,
  profileId,
  query,
}: {
  client: NonNullable<ReturnType<typeof useTrackerClient>>;
  collapsed: Set<string>;
  connectionName: string;
  onCollapsedChange(value: Set<string>): void;
  onNewChat(): void;
  onOpenConnections(): void;
  onOpenDiagnostics(): void;
  onOpenNotifications(): void;
  onOpenSettings(): void;
  onOpenTasks(): void;
  onOpenSession(threadId: number): void;
  onQueryChange(query: string): void;
  profileId: string;
  query: string;
}) {
  const library = useSessionLibrary({
    client,
    profileId,
    query,
    collapsedProjectSlugs: collapsed,
  });
  const toggleGroup = useCallback(
    (groupKey: string) => {
      const slug = groupKey.startsWith("project:") ? groupKey.slice("project:".length) : groupKey;
      const next = new Set(collapsed);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      onCollapsedChange(next);
    },
    [collapsed, onCollapsedChange],
  );

  return (
    <SessionLibraryScreen
      connectionDetail={library.viewerName ?? "Connected"}
      connectionName={connectionName}
      connectionState={library.error ? "offline" : "live"}
      error={library.error}
      groups={library.groups}
      loading={library.loading || library.refreshing}
      onNewChat={onNewChat}
      onOpenConnections={onOpenConnections}
      onOpenDiagnostics={onOpenDiagnostics}
      onOpenNotifications={onOpenNotifications}
      onOpenSettings={onOpenSettings}
      onOpenTasks={onOpenTasks}
      onOpenSession={onOpenSession}
      onQueryChange={onQueryChange}
      onRefresh={() => void library.refresh()}
      onToggleGroup={toggleGroup}
      query={query}
    />
  );
}

function useCollapsedProjects(
  profileId: string | null,
): [Set<string>, (next: Set<string>) => void] {
  const [stored, setStored] = useState<{ profileId: string; slugs: Set<string> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!profileId) {
      setStored(null);
      return () => {
        cancelled = true;
      };
    }

    void AsyncStorage.getItem(collapsedStorageKey(profileId)).then((value) => {
      if (cancelled) return;
      setStored({ profileId, slugs: parseCollapsedProjects(value) });
    });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const current = useMemo(
    () => (stored?.profileId === profileId ? stored.slugs : new Set<string>()),
    [profileId, stored],
  );
  const update = useCallback(
    (next: Set<string>) => {
      if (!profileId) return;
      setStored({ profileId, slugs: next });
      void AsyncStorage.setItem(collapsedStorageKey(profileId), JSON.stringify([...next].sort()));
    },
    [profileId],
  );

  return [current, update];
}

function collapsedStorageKey(profileId: string): string {
  return `${COLLAPSED_KEY_PREFIX}.${profileId}`;
}

function parseCollapsedProjects(value: string | null): Set<string> {
  if (!value) return new Set();
  try {
    const parsed: unknown = JSON.parse(value);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}
