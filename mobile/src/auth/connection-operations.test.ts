import { describe, expect, it, vi } from "vitest";

import type { TrackerClient } from "@/api/contracts";

import type { ConnectionProfile } from "./connection-profile";
import {
  removeConnectionProfileWithCleanup,
  validateAndReplaceConnectionToken,
} from "./connection-operations";

const profile: ConnectionProfile = {
  id: "profile-1",
  name: "Remote",
  origin: "https://demo.test",
  createdAt: "2026-07-24T00:00:00Z",
  lastConnectedAt: null,
};

function storage() {
  return {
    loadSnapshot: vi.fn().mockResolvedValue({
      profiles: [profile],
      activeProfileId: profile.id,
    }),
    loadToken: vi.fn().mockResolvedValue("old-token"),
    saveProfile: vi.fn(),
    selectProfile: vi.fn(),
    removeProfile: vi.fn().mockResolvedValue({ profiles: [], activeProfileId: null }),
    replaceToken: vi.fn().mockResolvedValue(undefined),
  };
}

describe("validateAndReplaceConnectionToken", () => {
  it("validates health and viewer before persisting a replacement token", async () => {
    const connectionStorage = storage();
    const client = {
      health: vi.fn().mockResolvedValue({ status: "ok" }),
      viewer: vi.fn().mockResolvedValue({ id: "viewer-1", name: "Raphael" }),
    } as unknown as TrackerClient;
    const createClient = vi.fn().mockReturnValue(client);

    await validateAndReplaceConnectionToken({
      createClient,
      locale: "pt-BR",
      profile,
      storage: connectionStorage,
      token: "new-token",
    });

    expect(createClient).toHaveBeenCalledWith({
      origin: profile.origin,
      token: "new-token",
      locale: "pt-BR",
    });
    expect(client.health).toHaveBeenCalledTimes(1);
    expect(client.viewer).toHaveBeenCalledTimes(1);
    expect(connectionStorage.replaceToken).toHaveBeenCalledWith(profile.id, "new-token");
  });

  it("keeps the existing token when validation fails", async () => {
    const connectionStorage = storage();
    const client = {
      health: vi.fn().mockRejectedValue(new Error("offline")),
      viewer: vi.fn(),
    } as unknown as TrackerClient;

    await expect(
      validateAndReplaceConnectionToken({
        createClient: vi.fn().mockReturnValue(client),
        locale: "en",
        profile,
        storage: connectionStorage,
        token: "bad-token",
      }),
    ).rejects.toThrow("offline");
    expect(connectionStorage.replaceToken).not.toHaveBeenCalled();
  });
});

describe("removeConnectionProfileWithCleanup", () => {
  it("unregisters native push before deleting the profile token and metadata", async () => {
    const connectionStorage = storage();
    const unregisterMobilePush = vi.fn().mockResolvedValue({ deleted: true });
    const client = { unregisterMobilePush } as unknown as TrackerClient;

    await removeConnectionProfileWithCleanup({
      createClient: vi.fn().mockReturnValue(client),
      deviceId: async () => "device-1",
      locale: "en",
      profileId: profile.id,
      storage: connectionStorage,
    });

    expect(unregisterMobilePush).toHaveBeenCalledWith({
      profileId: profile.id,
      deviceId: "device-1",
    });
    expect(connectionStorage.removeProfile).toHaveBeenCalledWith(profile.id);
  });
});
