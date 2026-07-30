import { renderHook, waitFor } from "@testing-library/react-native";
import type { ConnectionProfile } from "@/auth/connection-profile";

import type { HostProfile } from "./types";
import { usePersistedHosts } from "./use-persisted-hosts";

const mockLoadHosts = jest.fn<Promise<HostProfile[]>, []>();
let mockConnectionState: {
  hydrated: boolean;
  profiles: ConnectionProfile[];
};

jest.mock("@/auth/ConnectionProvider", () => ({
  useConnection: () => mockConnectionState,
}));
jest.mock("expo-router", () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    require("react").useEffect(effect, [effect]),
}));
jest.mock("./host-store", () => ({
  loadHosts: () => mockLoadHosts(),
}));

const persistedHost: HostProfile = {
  id: "profile-a",
  hostId: "host-a",
  name: "Dev10x workstation",
  endpoint: "ws://10.0.2.2:4111/mobile/rpc",
  deviceId: "device-a",
  deviceToken: "secret-a",
  publicKeyB64: "host-public-key",
  protocolVersion: 1,
  lastConnected: 123,
};

const persistedProfile: ConnectionProfile = {
  id: persistedHost.id,
  hostId: persistedHost.hostId,
  name: persistedHost.name,
  origin: persistedHost.endpoint,
  endpoint: persistedHost.endpoint,
  hostPublicKeyFingerprint: "sha256:key",
  transport: "rpc",
  protocolVersion: 1,
  createdAt: "2026-07-27T00:00:00.000Z",
  lastConnectedAt: null,
};

describe("usePersistedHosts", () => {
  beforeEach(() => {
    mockConnectionState = { hydrated: false, profiles: [] };
    mockLoadHosts.mockReset();
    mockLoadHosts.mockResolvedValue([persistedHost]);
  });

  it("reloads hosts when connection persistence finishes hydrating after the screen focuses", async () => {
    const { result, rerender } = renderHook(() => usePersistedHosts());

    expect(result.current.hosts).toEqual([]);
    expect(mockLoadHosts).not.toHaveBeenCalled();

    mockConnectionState = { hydrated: true, profiles: [persistedProfile] };
    rerender({});

    await waitFor(() => expect(result.current.hosts).toEqual([persistedHost]));
    expect(mockLoadHosts).toHaveBeenCalledTimes(1);
  });
});
