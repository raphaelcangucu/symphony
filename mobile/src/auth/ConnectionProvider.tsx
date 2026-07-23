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
} from "@/auth/connection-profile";
import {
  createConnectionStorage,
  type ConnectionStorage,
  type ConnectionStorageSnapshot,
} from "@/auth/connection-storage";

export type SaveConnectionInput = CreateConnectionProfileInput & {
  token: string;
};

export type ConnectionContextValue = {
  profiles: ConnectionProfile[];
  activeProfile: ConnectionProfile | null;
  activeToken: string | null;
  hydrated: boolean;
  selectProfile(id: string): Promise<void>;
  saveProfile(input: SaveConnectionInput): Promise<ConnectionProfile>;
  removeProfile(id: string): Promise<void>;
  replaceToken(id: string, token: string): Promise<void>;
};

type ConnectionProviderProps = {
  children: ReactNode;
  storage?: ConnectionStorage;
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

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({
  children,
  storage = defaultStorage,
}: ConnectionProviderProps) {
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const loadActiveToken = useCallback(
    async (nextSnapshot: ConnectionStorageSnapshot) => {
      const token = nextSnapshot.activeProfileId
        ? await storage.loadToken(nextSnapshot.activeProfileId)
        : null;
      setActiveToken(token);
    },
    [storage],
  );

  useEffect(() => {
    let cancelled = false;

    void storage
      .loadSnapshot()
      .then(async (storedSnapshot) => {
        const token = storedSnapshot.activeProfileId
          ? await storage.loadToken(storedSnapshot.activeProfileId)
          : null;
        if (!cancelled) {
          setSnapshot(storedSnapshot);
          setActiveToken(token);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSnapshot(emptySnapshot);
          setActiveToken(null);
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
      const nextSnapshot = await storage.removeProfile(id);
      setSnapshot(nextSnapshot);
      await loadActiveToken(nextSnapshot);
    },
    [loadActiveToken, storage],
  );

  const replaceToken = useCallback(
    async (id: string, token: string) => {
      await storage.replaceToken(id, token);
      if (snapshot.activeProfileId === id) {
        setActiveToken(await storage.loadToken(id));
      }
    },
    [snapshot.activeProfileId, storage],
  );

  const activeProfile =
    snapshot.profiles.find((profile) => profile.id === snapshot.activeProfileId) ?? null;
  const value = useMemo<ConnectionContextValue>(
    () => ({
      profiles: snapshot.profiles,
      activeProfile,
      activeToken,
      hydrated,
      selectProfile,
      saveProfile,
      removeProfile,
      replaceToken,
    }),
    [
      activeProfile,
      activeToken,
      hydrated,
      removeProfile,
      replaceToken,
      saveProfile,
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
