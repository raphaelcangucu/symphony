import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert } from "react-native";

import { useConnection } from "@/auth/ConnectionProvider";
import { useAppRuntime } from "@/runtime/AppRuntime";

import { ConnectionsScreen, type ConnectionHealth } from "./ConnectionsScreen";

export function ConnectionsRoute() {
  const router = useRouter();
  const runtime = useAppRuntime();
  const { activeProfile, loadToken, profiles, removeProfile, replaceToken, selectProfile } =
    useConnection();
  const [health, setHealth] = useState<Record<string, ConnectionHealth>>({});
  const [busyProfileId, setBusyProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setHealth(Object.fromEntries(profiles.map((profile) => [profile.id, "checking"])));
    void Promise.all(
      profiles.map(async (profile) => {
        try {
          const token = await loadToken(profile.id);
          if (!token) throw new Error("Missing token");
          const client = runtime.createTrackerClient({
            origin: profile.origin,
            token,
            locale: resolvedLocale(),
          });
          await client.health();
          await client.viewer();
          if (active) {
            setHealth((current) => ({ ...current, [profile.id]: "live" }));
          }
        } catch {
          if (active) {
            setHealth((current) => ({ ...current, [profile.id]: "offline" }));
          }
        }
      }),
    );
    return () => {
      active = false;
    };
  }, [loadToken, profiles, runtime.createTrackerClient]);

  async function perform(profileId: string, operation: () => Promise<void>) {
    if (busyProfileId) return;
    setBusyProfileId(profileId);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Connection action failed");
    } finally {
      setBusyProfileId(null);
    }
  }

  async function reconnect(profileId: string) {
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (!profile) return;
    await perform(profileId, async () => {
      setHealth((current) => ({ ...current, [profileId]: "checking" }));
      const token = await loadToken(profileId);
      if (!token) throw new Error("Connection token is missing");
      const client = runtime.createTrackerClient({
        origin: profile.origin,
        token,
        locale: resolvedLocale(),
      });
      await client.health();
      await client.viewer();
      await selectProfile(profileId);
      setHealth((current) => ({ ...current, [profileId]: "live" }));
    });
  }

  function confirmRemove(profileId: string) {
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (!profile) return;
    Alert.alert(
      "Remove connection?",
      `${profile.name} and its protected token will be removed from this device.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => void perform(profileId, () => removeProfile(profileId)),
        },
      ],
    );
  }

  return (
    <ConnectionsScreen
      activeProfileId={activeProfile?.id ?? null}
      busyProfileId={busyProfileId}
      error={error}
      health={health}
      onAdd={() => router.push("/connect")}
      onBack={() => router.back()}
      onReconnect={(profileId) => void reconnect(profileId)}
      onRemove={confirmRemove}
      onReplaceToken={(profileId, token) =>
        void perform(profileId, () => replaceToken(profileId, token))
      }
      onSelect={(profileId) => void perform(profileId, () => selectProfile(profileId))}
      profiles={profiles}
    />
  );
}

function resolvedLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en";
  } catch {
    return "en";
  }
}
