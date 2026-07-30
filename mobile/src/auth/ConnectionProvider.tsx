import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  createConnectionProfile,
  type ConnectionProfile,
  type CreateConnectionProfileInput,
  type HostProfile,
} from "@/auth/connection-profile";
import type { HostCredential } from "@/auth/host-credential-storage";
import {
  removeConnectionProfileWithCleanup,
  validateAndReplaceConnectionToken,
} from "@/auth/connection-operations";
import {
  createConnectionStorage,
  type ConnectionStorage,
  type ConnectionStorageSnapshot,
} from "@/auth/connection-storage";
import { useAppRuntime } from "@/runtime/AppRuntime";

export type SaveConnectionInput = CreateConnectionProfileInput & {
  token: string;
};

export type ConnectionContextValue = {
  profiles: ConnectionProfile[];
  activeProfile: ConnectionProfile | null;
  activeHostId: string | null;
  activeToken: string | null;
  activeHostCredential: HostCredential | null;
  hydrated: boolean;
  loadToken(id: string): Promise<string | null>;
  loadHostCredential(id: string): Promise<HostCredential | null>;
  selectProfile(id: string): Promise<void>;
  saveProfile(input: SaveConnectionInput): Promise<ConnectionProfile>;
  saveHostProfile(profile: HostProfile, credential: HostCredential): Promise<HostProfile>;
  removeProfile(id: string): Promise<void>;
  replaceToken(id: string, token: string): Promise<void>;
};

type ConnectionProviderProps = {
  children: ReactNode;
  storage?: ConnectionStorage | undefined;
};

const defaultStorage = createConnectionStorage({
  metadataStorage: AsyncStorage,
  secureStorage: {
    getItemAsync: (key) => SecureStore.getItemAsync(key),
    setItemAsync: (key, value) => SecureStore.setItemAsync(key, value),
    deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
  },
});

const emptySnapshot: ConnectionStorageSnapshot = {
  profiles: [],
  activeProfileId: null,
};
const emptyTokenState = {
  profileId: null as string | null,
  token: null as string | null,
};
const emptyHostCredentialState = {
  profileId: null as string | null,
  credential: null as HostCredential | null,
};

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({
  children,
  storage = defaultStorage,
}: ConnectionProviderProps) {
  const runtime = useAppRuntime();
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [tokenState, setTokenState] = useState(emptyTokenState);
  const [hostCredentialState, setHostCredentialState] = useState(emptyHostCredentialState);
  const [hydrated, setHydrated] = useState(false);

  const loadActiveToken = useCallback(
    async (nextSnapshot: ConnectionStorageSnapshot) => {
      const profileId = nextSnapshot.activeProfileId;
      const token = profileId ? await storage.loadToken(profileId) : null;
      const hostCredential = profileId ? await storage.loadHostCredential(profileId) : null;
      setTokenState({ profileId, token });
      setHostCredentialState({ profileId, credential: hostCredential });
    },
    [storage],
  );

  useEffect(() => {
    let cancelled = false;

    void storage
      .loadSnapshot()
      .then(async (storedSnapshot) => {
        const [token, hostCredential] = storedSnapshot.activeProfileId
          ? await Promise.all([
              storage.loadToken(storedSnapshot.activeProfileId),
              storage.loadHostCredential(storedSnapshot.activeProfileId),
            ])
          : [null, null];
        if (!cancelled) {
          setSnapshot(storedSnapshot);
          setTokenState({ profileId: storedSnapshot.activeProfileId, token });
          setHostCredentialState({
            profileId: storedSnapshot.activeProfileId,
            credential: hostCredential,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSnapshot(emptySnapshot);
          setTokenState(emptyTokenState);
          setHostCredentialState(emptyHostCredentialState);
        }
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, [storage]);

  const selectProfile = useCallback(
    async (id: string) => {
      const nextSnapshot = await storage.selectProfile(id);
      setSnapshot(nextSnapshot);
      await loadActiveToken(nextSnapshot);
    },
    [loadActiveToken, storage],
  );

  const saveProfile = useCallback(
    async (input: SaveConnectionInput) => {
      const profile = createConnectionProfile(input, {
        createId: createProfileId,
        now: () => new Date().toISOString(),
      });
      const nextSnapshot = await storage.saveProfile(profile, input.token);
      setSnapshot(nextSnapshot);
      await loadActiveToken(nextSnapshot);
      return profile;
    },
    [loadActiveToken, storage],
  );

  const removeProfile = useCallback(
    async (id: string) => {
      const profile = snapshot.profiles.find((candidate) => candidate.id === id);
      const nextSnapshot =
        profile?.transport === "rpc"
          ? await storage.removeProfile(id)
          : await removeConnectionProfileWithCleanup({
              createClient: runtime.createTrackerClient,
              deviceId: runtime.notifications.deviceId,
              locale: resolvedLocale(),
              profileId: id,
              storage,
            });
      setSnapshot(nextSnapshot);
      await loadActiveToken(nextSnapshot);
    },
    [
      loadActiveToken,
      runtime.createTrackerClient,
      runtime.notifications.deviceId,
      snapshot.profiles,
      storage,
    ],
  );
  const saveHostProfile = useCallback(
    async (profile: HostProfile, credential: HostCredential) => {
      const nextSnapshot = await storage.saveHostProfile(profile, credential);
      setSnapshot(nextSnapshot);
      await loadActiveToken(nextSnapshot);
      return profile;
    },
    [loadActiveToken, storage],
  );

  const replaceToken = useCallback(
    async (id: string, token: string) => {
      const profile = snapshot.profiles.find((candidate) => candidate.id === id);
      if (!profile) throw new Error("Connection profile not found");
      if (profile.transport === "rpc") {
        throw new Error("RPC device credentials are rotated by pairing again");
      }
      await validateAndReplaceConnectionToken({
        createClient: runtime.createTrackerClient,
        locale: resolvedLocale(),
        profile,
        storage,
        token,
      });
      if (snapshot.activeProfileId === id) {
        setTokenState({ profileId: id, token: await storage.loadToken(id) });
      }
    },
    [runtime.createTrackerClient, snapshot.activeProfileId, snapshot.profiles, storage],
  );
  const loadToken = useCallback((id: string) => storage.loadToken(id), [storage]);
  const loadHostCredential = useCallback((id: string) => storage.loadHostCredential(id), [storage]);

  const activeProfile =
    snapshot.profiles.find((profile) => profile.id === snapshot.activeProfileId) ?? null;
  const activeToken = tokenState.profileId === activeProfile?.id ? tokenState.token : null;
  const activeHostCredential =
    hostCredentialState.profileId === activeProfile?.id ? hostCredentialState.credential : null;
  const value = useMemo<ConnectionContextValue>(
    () => ({
      profiles: snapshot.profiles,
      activeProfile,
      activeHostId: activeProfile?.hostId ?? activeProfile?.id ?? null,
      activeToken,
      activeHostCredential,
      hydrated,
      loadToken,
      loadHostCredential,
      selectProfile,
      saveProfile,
      saveHostProfile,
      removeProfile,
      replaceToken,
    }),
    [
      activeProfile,
      activeToken,
      activeHostCredential,
      hydrated,
      loadHostCredential,
      loadToken,
      removeProfile,
      replaceToken,
      saveProfile,
      saveHostProfile,
      selectProfile,
      snapshot.profiles,
    ],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext);
  if (!value) {
    throw new Error("useConnection must be used within ConnectionProvider");
  }
  return value;
}

function createProfileId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function resolvedLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en";
  } catch {
    return "en";
  }
}
