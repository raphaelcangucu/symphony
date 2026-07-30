import { render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import type { HostTransport } from "@/transport/HostTransport";

import {
  HostRuntimeProvider,
  useHostRuntime,
  type HostRuntimeTransportFactory,
} from "./HostRuntimeProvider";

const mockUseConnection = jest.fn();

jest.mock("@/auth/ConnectionProvider", () => ({
  useConnection: () => mockUseConnection(),
}));
jest.mock("@/rpc/client", () => ({
  RpcClient: jest.fn(),
}));
jest.mock("@/rpc/websocket-adapter", () => ({
  HandshakeWebSocketAdapter: jest.fn(),
}));

function RuntimeConsumers() {
  const runtime = useHostRuntime();
  const transport = runtime.transport("profile-a");
  const state = runtime.state("profile-a");
  return (
    <>
      <Text>{transport ? `dev10x:${transport.hostId}` : "dev10x:missing"}</Text>
      <Text>{`selected:${runtime.selectedHostId}`}</Text>
      <Text>{`state:${state.hostId}`}</Text>
    </>
  );
}

describe("HostRuntimeProvider", () => {
  it("creates one Symphony transport for the unified Dev10x interface", async () => {
    const transport: HostTransport = {
      hostId: "host-a",
      call: jest.fn(),
      subscribe: jest.fn(async () => () => undefined),
      reconnect: jest.fn(),
      deactivate: jest.fn(),
      close: jest.fn(),
    };
    const createTransport = jest.fn(() => transport) as HostRuntimeTransportFactory;
    const profile = {
      id: "profile-a",
      hostId: "host-a",
      name: "Studio",
      origin: "https://studio.test",
      endpoint: "wss://studio.test/mobile/rpc",
      transport: "rpc",
      hostPublicKeyFingerprint: "fingerprint",
      protocolVersion: 1,
      createdAt: "2026-07-25T00:00:00Z",
      lastConnectedAt: null,
    };
    mockUseConnection.mockReturnValue({
      hydrated: true,
      profiles: [profile],
      activeProfile: profile,
      loadHostCredential: jest.fn(async () => ({
        deviceId: "device-a",
        deviceToken: "secret",
        hostPublicKey: "public-key",
      })),
      selectProfile: jest.fn(async () => undefined),
    });

    render(
      <HostRuntimeProvider createTransport={createTransport}>
        <RuntimeConsumers />
      </HostRuntimeProvider>,
    );

    await waitFor(() => expect(screen.getByText("dev10x:host-a")).toBeTruthy());
    expect(screen.getByText("selected:host-a")).toBeTruthy();
    expect(screen.getByText("state:host-a")).toBeTruthy();
    expect(createTransport).toHaveBeenCalledTimes(1);
  });
});
