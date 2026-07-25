import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { useState } from "react";
import { Pressable, Text } from "react-native";

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
  const [mode, setMode] = useState("workspace");
  const transport = runtime.transport("host-a");
  return (
    <>
      <Text>{transport ? `orca:${transport.hostId}` : "orca:missing"}</Text>
      <Text>{transport ? `codex:${transport.hostId}` : "codex:missing"}</Text>
      <Text>{mode}</Text>
      <Pressable accessibilityRole="button" onPress={() => setMode("compact")}>
        <Text>Change interface</Text>
      </Pressable>
    </>
  );
}

describe("HostRuntimeProvider", () => {
  it("creates one Symphony transport shared by both interfaces across view changes", async () => {
    const transport: HostTransport = {
      hostId: "host-a",
      call: jest.fn(),
      subscribe: jest.fn(async () => () => undefined),
      reconnect: jest.fn(),
      deactivate: jest.fn(),
      close: jest.fn(),
    };
    const createTransport = jest.fn(() => transport) as HostRuntimeTransportFactory;
    mockUseConnection.mockReturnValue({
      hydrated: true,
      profiles: [
        {
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
        },
      ],
      activeProfile: { id: "profile-a", hostId: "host-a", transport: "rpc" },
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

    await waitFor(() => expect(screen.getByText("orca:host-a")).toBeTruthy());
    expect(screen.getByText("codex:host-a")).toBeTruthy();
    expect(createTransport).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByRole("button", { name: "Change interface" }));
    expect(screen.getByText("compact")).toBeTruthy();
    expect(createTransport).toHaveBeenCalledTimes(1);
  });
});
