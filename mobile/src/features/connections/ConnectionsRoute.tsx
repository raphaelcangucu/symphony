import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";

import {
  type HostTransportState,
  useHostTransport,
  useHostTransportState,
} from "@/api/HostTransportContext";
import { useConnection } from "@/auth/ConnectionProvider";
import { useAppRuntime } from "@/runtime/AppRuntime";

import { ConnectionsScreen, type ConnectionHealth, type PairedDevice } from "./ConnectionsScreen";

export function ConnectionsRoute() {
  const router = useRouter();
  const runtime = useAppRuntime();
  const hostTransport = useHostTransport();
  const hostTransportState = useHostTransportState();
  const { activeProfile, loadToken, profiles, removeProfile, replaceToken, selectProfile } =
    useConnection();
  const [health, setHealth] = useState<Record<string, ConnectionHealth>>({});
  const [busyProfileId, setBusyProfileId] = useState<string | null>(null);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setHealth(
      Object.fromEntries(
        profiles.map((profile) => [
          profile.id,
          profile.transport === "rpc" ? "offline" : "checking",
        ]),
      ),
    );
    void Promise.all(
      profiles.map(async (profile) => {
        if (profile.transport === "rpc") return;
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

  useEffect(() => {
    if (activeProfile?.transport !== "rpc") return;
    setHealth((current) => ({
      ...current,
      [activeProfile.id]: rpcConnectionHealth(hostTransportState?.status),
    }));
  }, [activeProfile?.id, activeProfile?.transport, hostTransportState?.status]);

  const refreshDevices = useCallback(async () => {
    if (activeProfile?.transport !== "rpc" || !hostTransport) {
      setPairedDevices([]);
      return;
    }
    setDevicesLoading(true);
    try {
      const result = await hostTransport.call<{ devices: unknown[] }>("devices.list", {});
      setPairedDevices(parsePairedDevices(result.devices));
    } finally {
      setDevicesLoading(false);
    }
  }, [activeProfile?.transport, hostTransport]);

  useEffect(() => {
    if (
      activeProfile?.transport !== "rpc" ||
      hostTransportState?.status !== "online" ||
      !hostTransport
    ) {
      setPairedDevices([]);
      return;
    }
    void refreshDevices().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not load paired devices");
    });
  }, [
    activeProfile?.id,
    activeProfile?.transport,
    hostTransport,
    hostTransportState?.status,
    refreshDevices,
  ]);

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
      if (profile.transport === "rpc") {
        if (activeProfile?.id === profileId) {
          hostTransport?.reconnect();
        } else {
          await selectProfile(profileId);
        }
        return;
      }
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
      `${profile.name} and its protected device credential will be removed from this device.`,
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

  function confirmRevokeDevice(deviceId: string) {
    const device = pairedDevices.find((candidate) => candidate.deviceId === deviceId);
    if (!device || device.current || !hostTransport) return;
    Alert.alert(
      "Revoke paired device?",
      `${device.name} will immediately lose access to this Symphony host.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: () => {
            if (busyDeviceId) return;
            setBusyDeviceId(deviceId);
            setError(null);
            void hostTransport
              .call("devices.revoke", { device_id: deviceId })
              .then(refreshDevices)
              .catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : "Could not revoke paired device");
              })
              .finally(() => setBusyDeviceId(null));
          },
        },
      ],
    );
  }

  return (
    <ConnectionsScreen
      activeProfileId={activeProfile?.id ?? null}
      busyDeviceId={busyDeviceId}
      busyProfileId={busyProfileId}
      devicesLoading={devicesLoading}
      error={error}
      health={health}
      onAdd={() => router.push("/connect")}
      onBack={() => router.back()}
      onRefreshDevices={() =>
        void refreshDevices().catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : "Could not load paired devices"),
        )
      }
      onReconnect={(profileId) => void reconnect(profileId)}
      onRemove={confirmRemove}
      onRevokeDevice={confirmRevokeDevice}
      onReplaceToken={(profileId, token) =>
        void perform(profileId, () => replaceToken(profileId, token))
      }
      onSelect={(profileId) => void perform(profileId, () => selectProfile(profileId))}
      pairedDevices={pairedDevices}
      profiles={profiles}
    />
  );
}

export function parsePairedDevices(value: unknown): PairedDevice[] {
  if (!Array.isArray(value)) throw new Error("Invalid paired devices response");
  return value.map((candidate) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof (candidate as Record<string, unknown>).device_id !== "string" ||
      typeof (candidate as Record<string, unknown>).name !== "string" ||
      typeof (candidate as Record<string, unknown>).current !== "boolean"
    ) {
      throw new Error("Invalid paired device");
    }
    const record = candidate as Record<string, unknown>;
    return {
      deviceId: record.device_id as string,
      name: record.name as string,
      current: record.current as boolean,
      lastSeenAt: typeof record.last_seen_at === "string" ? record.last_seen_at : null,
      protocolVersion: typeof record.protocol_version === "number" ? record.protocol_version : null,
    };
  });
}

function rpcConnectionHealth(state: HostTransportState["status"] | undefined): ConnectionHealth {
  if (state === "online") return "live";
  if (state === "connecting" || state === "handshaking" || state === "authenticating") {
    return "checking";
  }
  return "offline";
}

function resolvedLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en";
  } catch {
    return "en";
  }
}
