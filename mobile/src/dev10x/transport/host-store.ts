import type {
  ConnectionProfile,
  HostProfile as ConnectionHostProfile,
} from "@/auth/connection-profile";
import type { HostCredential } from "@/auth/host-credential-storage";

import { getNextHostNameFromHosts } from "./host-names";
import type { HostProfile } from "./types";

export type ConnectionHostStoreSource = {
  profiles: ConnectionProfile[];
  loadHostCredential(profileId: string): Promise<HostCredential | null>;
  saveHostProfile(
    profile: ConnectionHostProfile,
    credential: HostCredential,
  ): Promise<ConnectionHostProfile>;
  removeProfile(profileId: string): Promise<void>;
};

export type ConnectionBackedHostStore = {
  loadHosts(): Promise<HostProfile[]>;
  saveHost(host: HostProfile): Promise<void>;
  removeHost(hostId: string): Promise<void>;
  renameHost(hostId: string, newName: string): Promise<void>;
  getNextHostName(): Promise<string>;
  updateLastConnected(hostId: string): Promise<void>;
};

let activeStore: ConnectionBackedHostStore | null = null;

export function createConnectionBackedHostStore(
  source: ConnectionHostStoreSource,
  dependencies: {
    fingerprint(hostPublicKey: string): Promise<string>;
  } = {
    async fingerprint(hostPublicKey) {
      const { hostPublicKeyFingerprint } = await import("@/auth/host-profile");
      return hostPublicKeyFingerprint(hostPublicKey);
    },
  },
): ConnectionBackedHostStore {
  async function loadHosts(): Promise<HostProfile[]> {
    const hosts = await Promise.all(
      source.profiles.filter(isRpcHostProfile).map(async (profile) => {
        const credential = await source.loadHostCredential(profile.id);
        return credential ? presentHost(profile, credential) : null;
      }),
    );
    return hosts.filter((host): host is HostProfile => host !== null);
  }

  async function saveHost(host: HostProfile): Promise<void> {
    const now = new Date();
    const existing = source.profiles.find((profile) => profile.id === host.id);
    const profile: ConnectionHostProfile = {
      id: host.id,
      hostId: host.hostId,
      name: host.name.trim() || "Symphony host",
      origin: host.endpoint,
      endpoint: host.endpoint,
      hostPublicKeyFingerprint: await dependencies.fingerprint(host.publicKeyB64),
      transport: "rpc",
      protocolVersion: host.protocolVersion,
      createdAt: existing?.createdAt ?? now.toISOString(),
      lastConnectedAt: host.lastConnected > 0 ? new Date(host.lastConnected).toISOString() : null,
    };
    const credential: HostCredential = {
      deviceId: host.deviceId,
      deviceToken: host.deviceToken,
      hostPublicKey: host.publicKeyB64,
    };
    await source.saveHostProfile(profile, credential);
  }

  async function mutateHost(
    hostId: string,
    mutate: (host: HostProfile) => HostProfile,
  ): Promise<void> {
    const host = (await loadHosts()).find(
      (candidate) => candidate.id === hostId || candidate.hostId === hostId,
    );
    if (!host) return;
    await saveHost(mutate(host));
  }

  return {
    loadHosts,
    saveHost,
    async removeHost(hostId) {
      const profile = source.profiles.find(
        (candidate) => candidate.id === hostId || candidate.hostId === hostId,
      );
      if (profile) await source.removeProfile(profile.id);
    },
    renameHost: (hostId, newName) =>
      mutateHost(hostId, (host) => ({ ...host, name: newName.trim() || host.name })),
    async getNextHostName() {
      return getNextHostNameFromHosts(await loadHosts());
    },
    updateLastConnected: (hostId) =>
      mutateHost(hostId, (host) => ({ ...host, lastConnected: Date.now() })),
  };
}

export function bindConnectionHostStore(
  source: ConnectionHostStoreSource,
): ConnectionBackedHostStore {
  const store = createConnectionBackedHostStore(source);
  activeStore = store;
  return store;
}

export function unbindConnectionHostStore(store?: ConnectionBackedHostStore): void {
  if (!store || activeStore === store) {
    activeStore = null;
  }
}

export function loadHosts(): Promise<HostProfile[]> {
  return requireStore().loadHosts();
}

export function saveHost(host: HostProfile): Promise<void> {
  return requireStore().saveHost(host);
}

export function removeHost(hostId: string): Promise<void> {
  return requireStore().removeHost(hostId);
}

export function renameHost(hostId: string, newName: string): Promise<void> {
  return requireStore().renameHost(hostId, newName);
}

export function getNextHostName(): Promise<string> {
  return requireStore().getNextHostName();
}

export function updateLastConnected(hostId: string): Promise<void> {
  return requireStore().updateLastConnected(hostId);
}

function requireStore(): ConnectionBackedHostStore {
  if (!activeStore) {
    throw new Error("Dev10x host store is not connected to ConnectionProvider");
  }
  return activeStore;
}

function isRpcHostProfile(profile: ConnectionProfile): profile is ConnectionHostProfile {
  return (
    profile.transport === "rpc" &&
    typeof profile.hostId === "string" &&
    typeof profile.endpoint === "string" &&
    typeof profile.hostPublicKeyFingerprint === "string"
  );
}

function presentHost(profile: ConnectionHostProfile, credential: HostCredential): HostProfile {
  return {
    id: profile.id,
    hostId: profile.hostId,
    name: profile.name,
    endpoint: profile.endpoint,
    deviceId: credential.deviceId,
    deviceToken: credential.deviceToken,
    publicKeyB64: credential.hostPublicKey,
    protocolVersion: profile.protocolVersion ?? 1,
    lastConnected: profile.lastConnectedAt ? Date.parse(profile.lastConnectedAt) : 0,
  };
}
