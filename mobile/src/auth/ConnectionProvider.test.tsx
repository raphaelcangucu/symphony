import { fireEvent, render, screen } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import type { ConnectionStorage, ConnectionStorageSnapshot } from "./connection-storage";
import type { HostCredential } from "./host-credential-storage";
import type { HostProfile } from "./connection-profile";
import { ConnectionProvider, useConnection } from "./ConnectionProvider";

jest.mock("@/runtime/AppRuntime", () => ({
  useAppRuntime: () => ({
    createTrackerClient: jest.fn(),
    notifications: { deviceId: "test-device" },
  }),
}));

const alphaProfile = hostProfile("alpha-profile", "host-alpha", "Studio Alpha", 4101);
const betaProfile = hostProfile("beta-profile", "host-beta", "Studio Beta", 4102);
const legacyAlphaProfile = legacyProfile("legacy-alpha", "Legacy Alpha", 5101);
const legacyBetaProfile = legacyProfile("legacy-beta", "Legacy Beta", 5102);
const alphaCredential: HostCredential = {
  deviceId: "alpha-device",
  deviceToken: "alpha-token",
  hostPublicKey: "alpha-key",
};
const betaCredential: HostCredential = {
  deviceId: "beta-device",
  deviceToken: "beta-token",
  hostPublicKey: "beta-key",
};

function ConnectionState() {
  const connection = useConnection();
  return (
    <>
      <Text>
        {connection.activeProfile?.id ?? "none"}:
        {connection.activeHostCredential?.deviceId ?? "none"}
      </Text>
      <Pressable
        accessibilityLabel="Pair beta"
        onPress={() => void connection.saveHostProfile(betaProfile, betaCredential)}
      >
        <Text>Pair beta</Text>
      </Pressable>
    </>
  );
}

function LegacyTokenState() {
  const connection = useConnection();
  return (
    <>
      <Text>
        {connection.activeProfile?.id ?? "none"}:{connection.activeToken ?? "none"}
      </Text>
      <Pressable
        accessibilityLabel="Select beta"
        onPress={() => void connection.selectProfile(legacyBetaProfile.id)}
      >
        <Text>Select beta</Text>
      </Pressable>
    </>
  );
}

describe("ConnectionProvider", () => {
  it("never exposes a credential from the previous host while activating a new profile", async () => {
    let releaseBetaCredential: ((credential: HostCredential) => void) | undefined;
    const betaCredentialPending = new Promise<HostCredential>((resolve) => {
      releaseBetaCredential = resolve;
    });
    const initialSnapshot: ConnectionStorageSnapshot = {
      profiles: [alphaProfile],
      activeProfileId: alphaProfile.id,
    };
    const betaSnapshot: ConnectionStorageSnapshot = {
      profiles: [alphaProfile, betaProfile],
      activeProfileId: betaProfile.id,
    };
    const storage: ConnectionStorage = {
      loadSnapshot: jest.fn(async () => initialSnapshot),
      loadToken: jest.fn(async (profileId) =>
        profileId === alphaProfile.id ? alphaCredential.deviceToken : betaCredential.deviceToken,
      ),
      loadHostCredential: jest.fn((profileId) =>
        profileId === alphaProfile.id ? Promise.resolve(alphaCredential) : betaCredentialPending,
      ),
      saveProfile: jest.fn(),
      saveHostProfile: jest.fn(async () => betaSnapshot),
      selectProfile: jest.fn(),
      removeProfile: jest.fn(),
      replaceToken: jest.fn(),
    };

    render(
      <ConnectionProvider storage={storage}>
        <ConnectionState />
      </ConnectionProvider>,
    );

    expect(await screen.findByText("alpha-profile:alpha-device")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Pair beta"));

    expect(await screen.findByText("beta-profile:none")).toBeTruthy();
    releaseBetaCredential?.(betaCredential);
    expect(await screen.findByText("beta-profile:beta-device")).toBeTruthy();
  });

  it("never exposes a legacy token from the previous host while selecting a new profile", async () => {
    let releaseBetaToken: ((token: string) => void) | undefined;
    const betaTokenPending = new Promise<string>((resolve) => {
      releaseBetaToken = resolve;
    });
    const initialSnapshot: ConnectionStorageSnapshot = {
      profiles: [legacyAlphaProfile, legacyBetaProfile],
      activeProfileId: legacyAlphaProfile.id,
    };
    const betaSnapshot: ConnectionStorageSnapshot = {
      profiles: [legacyAlphaProfile, legacyBetaProfile],
      activeProfileId: legacyBetaProfile.id,
    };
    const storage: ConnectionStorage = {
      loadSnapshot: jest.fn(async () => initialSnapshot),
      loadToken: jest.fn((profileId) =>
        profileId === legacyAlphaProfile.id ? Promise.resolve("alpha-token") : betaTokenPending,
      ),
      loadHostCredential: jest.fn(async () => null),
      saveProfile: jest.fn(),
      saveHostProfile: jest.fn(),
      selectProfile: jest.fn(async () => betaSnapshot),
      removeProfile: jest.fn(),
      replaceToken: jest.fn(),
    };

    render(
      <ConnectionProvider storage={storage}>
        <LegacyTokenState />
      </ConnectionProvider>,
    );

    expect(await screen.findByText("legacy-alpha:alpha-token")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Select beta"));

    expect(await screen.findByText("legacy-beta:none")).toBeTruthy();
    releaseBetaToken?.("beta-token");
    expect(await screen.findByText("legacy-beta:beta-token")).toBeTruthy();
  });
});

function hostProfile(id: string, hostId: string, name: string, port: number): HostProfile {
  const endpoint = `ws://10.0.2.2:${port}/mobile/rpc`;
  return {
    id,
    hostId,
    name,
    origin: endpoint,
    endpoint,
    hostPublicKeyFingerprint: `sha256:${hostId}`,
    transport: "rpc",
    protocolVersion: 1,
    createdAt: "2026-07-25T12:00:00.000Z",
    lastConnectedAt: null,
  };
}

function legacyProfile(id: string, name: string, port: number): HostProfile {
  const endpoint = `http://10.0.2.2:${port}`;
  return {
    id,
    hostId: id,
    name,
    origin: endpoint,
    endpoint,
    hostPublicKeyFingerprint: "legacy-unpinned",
    transport: "legacy",
    protocolVersion: null,
    createdAt: "2026-07-25T12:00:00.000Z",
    lastConnectedAt: null,
  };
}
