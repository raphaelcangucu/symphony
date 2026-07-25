import { describe, expect, it, vi } from "vitest";

import type { HostCredential } from "@/auth/host-credential-storage";

import { createConnectionBackedHostStore } from "./host-store";
import type { HostProfile } from "./types";

const host: HostProfile = {
  id: "host-a",
  hostId: "host-a",
  name: "Mac Studio",
  endpoint: "wss://mac.example.test/mobile/rpc",
  deviceId: "device-a",
  deviceToken: "secret-a",
  publicKeyB64: "host-key-a",
  protocolVersion: 1,
  lastConnected: 123,
};

describe("connection-backed Orca host store", () => {
  it("keeps device credentials separate from persisted host metadata", async () => {
    const saveHostProfile = vi.fn(async (profile, _credential) => profile);
    const store = createConnectionBackedHostStore(
      {
        profiles: [],
        loadHostCredential: vi.fn(async () => null),
        saveHostProfile,
        removeProfile: vi.fn(async () => undefined),
      },
      { fingerprint: vi.fn(async () => "sha256:test") },
    );

    await store.saveHost(host);

    const [profile, credential] = saveHostProfile.mock.calls[0]!;
    expect(profile).not.toHaveProperty("deviceToken");
    expect(profile).not.toHaveProperty("hostPublicKey");
    expect(credential).toEqual<HostCredential>({
      deviceId: "device-a",
      deviceToken: "secret-a",
      hostPublicKey: "host-key-a",
    });
  });

  it("hydrates only RPC hosts whose secure credential is available", async () => {
    const store = createConnectionBackedHostStore({
      profiles: [
        {
          id: "host-a",
          hostId: "host-a",
          name: "Mac Studio",
          origin: host.endpoint,
          endpoint: host.endpoint,
          hostPublicKeyFingerprint: "sha256:key",
          transport: "rpc",
          protocolVersion: 1,
          createdAt: "2026-07-25T00:00:00.000Z",
          lastConnectedAt: "2026-07-25T00:00:01.000Z",
        },
        {
          id: "legacy",
          name: "Tracker",
          origin: "https://tracker.example.test",
          createdAt: "2026-07-25T00:00:00.000Z",
          lastConnectedAt: null,
        },
      ],
      loadHostCredential: vi.fn(async (id) =>
        id === "host-a"
          ? {
              deviceId: host.deviceId,
              deviceToken: host.deviceToken,
              hostPublicKey: host.publicKeyB64,
            }
          : null,
      ),
      saveHostProfile: vi.fn(),
      removeProfile: vi.fn(),
    });

    await expect(store.loadHosts()).resolves.toEqual([
      expect.objectContaining({ id: "host-a", hostId: "host-a", deviceToken: "secret-a" }),
    ]);
  });
});
