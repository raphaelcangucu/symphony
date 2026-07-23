import type { ConnectionProfile } from "./connection-profile";

export const CONNECTIONS_STORAGE_KEY = "symphony.connections";
const CONNECTION_CREDENTIAL_PREFIX = "symphony.connection.";

export interface AsyncStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SecureStorageAdapter {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface ConnectionStorageSnapshot {
  profiles: ConnectionProfile[];
  activeProfileId: string | null;
}

export interface ConnectionStorage {
  loadSnapshot(): Promise<ConnectionStorageSnapshot>;
  loadToken(profileId: string): Promise<string | null>;
  saveProfile(profile: ConnectionProfile, token: string): Promise<ConnectionStorageSnapshot>;
  selectProfile(profileId: string): Promise<ConnectionStorageSnapshot>;
  removeProfile(profileId: string): Promise<ConnectionStorageSnapshot>;
  replaceToken(profileId: string, token: string): Promise<void>;
}

type ConnectionStorageAdapters = {
  metadataStorage: AsyncStorageAdapter;
  secureStorage: SecureStorageAdapter;
};

type StoredConnections = ConnectionStorageSnapshot & {
  version: 1;
};

const emptySnapshot: ConnectionStorageSnapshot = {
  profiles: [],
  activeProfileId: null,
};

export function connectionCredentialKey(profileId: string): string {
  return `${CONNECTION_CREDENTIAL_PREFIX}${profileId}.token`;
}

export function createConnectionStorage({
  metadataStorage,
  secureStorage,
}: ConnectionStorageAdapters): ConnectionStorage {
  let mutationQueue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function readSnapshot(): Promise<ConnectionStorageSnapshot> {
    const raw = await metadataStorage.getItem(CONNECTIONS_STORAGE_KEY);
    return parseStoredConnections(raw);
  }

  async function persistSnapshot(snapshot: ConnectionStorageSnapshot): Promise<void> {
    const stored: StoredConnections = {
      version: 1,
      profiles: snapshot.profiles,
      activeProfileId: snapshot.activeProfileId,
    };
    await metadataStorage.setItem(CONNECTIONS_STORAGE_KEY, JSON.stringify(stored));
  }

  async function requireProfile(profileId: string): Promise<ConnectionStorageSnapshot> {
    const snapshot = await readSnapshot();
    if (!snapshot.profiles.some((profile) => profile.id === profileId)) {
      throw new Error("Connection profile not found");
    }
    return snapshot;
  }

  return {
    async loadSnapshot() {
      await mutationQueue;
      return readSnapshot();
    },

    async loadToken(profileId) {
      await mutationQueue;
      return secureStorage.getItemAsync(connectionCredentialKey(profileId));
    },

    saveProfile(profile, token) {
      return enqueue(async () => {
        const normalizedToken = requiredToken(token);
        const snapshot = await readSnapshot();
        const existingIndex = snapshot.profiles.findIndex(
          (candidate) => candidate.id === profile.id,
        );
        const profiles = [...snapshot.profiles];

        if (existingIndex >= 0) {
          profiles[existingIndex] = profile;
        } else {
          profiles.push(profile);
        }

        const nextSnapshot: ConnectionStorageSnapshot = {
          profiles,
          activeProfileId: snapshot.activeProfileId ?? profile.id,
        };

        await secureStorage.setItemAsync(connectionCredentialKey(profile.id), normalizedToken);
        await persistSnapshot(nextSnapshot);
        return nextSnapshot;
      });
    },

    selectProfile(profileId) {
      return enqueue(async () => {
        const snapshot = await requireProfile(profileId);
        const nextSnapshot = { ...snapshot, activeProfileId: profileId };
        await persistSnapshot(nextSnapshot);
        return nextSnapshot;
      });
    },

    removeProfile(profileId) {
      return enqueue(async () => {
        const snapshot = await readSnapshot();
        const profiles = snapshot.profiles.filter((profile) => profile.id !== profileId);
        const activeProfileId =
          snapshot.activeProfileId === profileId
            ? (profiles[0]?.id ?? null)
            : normalizeActiveProfileId(snapshot.activeProfileId, profiles);
        const nextSnapshot = { profiles, activeProfileId };

        await secureStorage.deleteItemAsync(connectionCredentialKey(profileId));
        await persistSnapshot(nextSnapshot);
        return nextSnapshot;
      });
    },

    replaceToken(profileId, token) {
      return enqueue(async () => {
        await requireProfile(profileId);
        await secureStorage.setItemAsync(connectionCredentialKey(profileId), requiredToken(token));
      });
    },
  };
}

function parseStoredConnections(raw: string | null): ConnectionStorageSnapshot {
  if (!raw) return { ...emptySnapshot };

  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.profiles)) {
      return { ...emptySnapshot };
    }

    const profiles = value.profiles.filter(isConnectionProfile);
    const uniqueProfiles = profiles.filter(
      (profile, index) => profiles.findIndex((candidate) => candidate.id === profile.id) === index,
    );
    const requestedActiveId =
      typeof value.activeProfileId === "string" ? value.activeProfileId : null;

    return {
      profiles: uniqueProfiles,
      activeProfileId: normalizeActiveProfileId(requestedActiveId, uniqueProfiles),
    };
  } catch {
    return { ...emptySnapshot };
  }
}

function normalizeActiveProfileId(
  activeProfileId: string | null,
  profiles: ConnectionProfile[],
): string | null {
  if (activeProfileId && profiles.some((profile) => profile.id === activeProfileId)) {
    return activeProfileId;
  }
  return profiles[0]?.id ?? null;
}

function isConnectionProfile(value: unknown): value is ConnectionProfile {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.origin === "string" &&
    typeof value.createdAt === "string" &&
    (value.lastConnectedAt === null || typeof value.lastConnectedAt === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredToken(token: string): string {
  const value = token.trim();
  if (!value) throw new Error("Connection token is required");
  return value;
}
