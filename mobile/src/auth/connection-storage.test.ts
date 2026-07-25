import { describe, expect, it, vi } from "vitest";

import type { ConnectionProfile, HostProfile } from "./connection-profile";
import {
  CONNECTIONS_STORAGE_KEY,
  connectionCredentialKey,
  createConnectionStorage,
  type AsyncStorageAdapter,
  type SecureStorageAdapter,
} from "./connection-storage";

const firstProfile: ConnectionProfile = {
  id: "profile-1",
  name: "Local tracker",
  origin: "http://127.0.0.1:4000",
  createdAt: "2026-07-23T10:00:00.000Z",
  lastConnectedAt: null,
};

const secondProfile: ConnectionProfile = {
  id: "profile-2",
  name: "Remote tracker",
  origin: "https://tracker.example.com",
  createdAt: "2026-07-23T11:00:00.000Z",
  lastConnectedAt: null,
};

function createAdapters() {
  const metadata = new Map<string, string>();
  const secrets = new Map<string, string>();

  const metadataStorage: AsyncStorageAdapter = {
    getItem: vi.fn(async (key) => metadata.get(key) ?? null),
    setItem: vi.fn(async (key, value) => {
      metadata.set(key, value);
    }),
    removeItem: vi.fn(async (key) => {
      metadata.delete(key);
    }),
  };
  const secureStorage: SecureStorageAdapter = {
    getItemAsync: vi.fn(async (key) => secrets.get(key) ?? null),
    setItemAsync: vi.fn(async (key, value) => {
      secrets.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key) => {
      secrets.delete(key);
    }),
  };

  return { metadata, metadataStorage, secrets, secureStorage };
}

describe("connection storage", () => {
  it("migrates v1 tracker profiles to explicit legacy host metadata", async () => {
    const adapters = createAdapters();
    adapters.metadata.set(
      CONNECTIONS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        profiles: [firstProfile],
        activeProfileId: firstProfile.id,
      }),
    );
    const storage = createConnectionStorage(adapters);

    await expect(storage.loadSnapshot()).resolves.toEqual({
      profiles: [
        {
          ...firstProfile,
          hostId: firstProfile.id,
          endpoint: firstProfile.origin,
          hostPublicKeyFingerprint: "legacy-unpinned",
          transport: "legacy",
          protocolVersion: null,
        },
      ],
      activeProfileId: firstProfile.id,
    });
  });

  it("stores RPC device credentials and the full pinned key only in SecureStore", async () => {
    const adapters = createAdapters();
    const storage = createConnectionStorage(adapters);
    const rpcProfile: HostProfile = {
      id: "profile-rpc",
      hostId: "host_01",
      name: "Mac Studio",
      origin: "wss://mac-studio.test/mobile/rpc",
      endpoint: "wss://mac-studio.test/mobile/rpc",
      hostPublicKeyFingerprint: "sha256:abcd",
      transport: "rpc",
      protocolVersion: 1,
      createdAt: "2026-07-25T12:00:00.000Z",
      lastConnectedAt: null,
    };

    await storage.saveHostProfile(rpcProfile, {
      deviceId: "device_01",
      deviceToken: "device-secret",
      hostPublicKey: "full-static-public-key",
    });

    expect(JSON.stringify([...adapters.metadata.values()])).not.toContain("device-secret");
    expect(JSON.stringify([...adapters.metadata.values()])).not.toContain("full-static-public-key");
    await expect(storage.loadHostCredential(rpcProfile.id)).resolves.toEqual({
      deviceId: "device_01",
      deviceToken: "device-secret",
      hostPublicKey: "full-static-public-key",
    });
  });

  it("keeps profile metadata in AsyncStorage and the token only in SecureStore", async () => {
    const adapters = createAdapters();
    const storage = createConnectionStorage(adapters);

    await storage.saveProfile(firstProfile, "local-secret-token");

    expect(adapters.secureStorage.setItemAsync).toHaveBeenCalledWith(
      "symphony.connection.profile-1.token",
      "local-secret-token",
    );
    expect(adapters.metadataStorage.setItem).toHaveBeenCalledWith(
      CONNECTIONS_STORAGE_KEY,
      expect.any(String),
    );
    expect([...adapters.metadata.values()].join(" ")).not.toContain("local-secret-token");
    expect(await storage.loadToken(firstProfile.id)).toBe("local-secret-token");
  });

  it("hydrates only public metadata and selects the first saved profile", async () => {
    const adapters = createAdapters();
    const storage = createConnectionStorage(adapters);

    await storage.saveProfile(firstProfile, "first-secret");
    await storage.saveProfile(secondProfile, "second-secret");

    await expect(storage.loadSnapshot()).resolves.toEqual({
      profiles: [firstProfile, secondProfile],
      activeProfileId: firstProfile.id,
    });
    expect(JSON.stringify(await storage.loadSnapshot())).not.toContain("secret");
  });

  it("removes metadata and credentials while falling back to a remaining profile", async () => {
    const adapters = createAdapters();
    const storage = createConnectionStorage(adapters);
    await storage.saveProfile(firstProfile, "first-secret");
    await storage.saveProfile(secondProfile, "second-secret");
    await storage.selectProfile(secondProfile.id);

    const snapshot = await storage.removeProfile(secondProfile.id);

    expect(snapshot.activeProfileId).toBe(firstProfile.id);
    expect(snapshot.profiles).toEqual([firstProfile]);
    expect(adapters.secureStorage.deleteItemAsync).toHaveBeenCalledWith(
      connectionCredentialKey(secondProfile.id),
    );
    expect(adapters.secrets.has(connectionCredentialKey(secondProfile.id))).toBe(false);
  });

  it("replaces credentials without rewriting public metadata", async () => {
    const adapters = createAdapters();
    const storage = createConnectionStorage(adapters);
    await storage.saveProfile(firstProfile, "old-secret");
    vi.mocked(adapters.metadataStorage.setItem).mockClear();

    await storage.replaceToken(firstProfile.id, "new-secret");

    expect(await storage.loadToken(firstProfile.id)).toBe("new-secret");
    expect(adapters.metadataStorage.setItem).not.toHaveBeenCalled();
  });

  it("rejects selecting or replacing credentials for an unknown profile", async () => {
    const storage = createConnectionStorage(createAdapters());

    await expect(storage.selectProfile("missing")).rejects.toThrow("Connection profile not found");
    await expect(storage.replaceToken("missing", "secret")).rejects.toThrow(
      "Connection profile not found",
    );
  });
});
