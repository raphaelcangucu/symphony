import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import type { TrackerClient } from "./contracts";
import {
  TrackerClientProvider,
  useHostTransportState,
  useTrackerClient,
} from "./TrackerClientProvider";

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

function ClientState() {
  const client = useTrackerClient();
  return <Text>{client ? "bound" : "missing"}</Text>;
}

function TransportState() {
  const state = useHostTransportState();
  return <Text>{state ? `${state.hostId}:${state.status}` : "no-transport"}</Text>;
}

describe("TrackerClientProvider", () => {
  it("binds a client to the active connection without exposing the token", () => {
    const client = {} as TrackerClient;
    const createClient = jest.fn(() => client);
    mockUseConnection.mockReturnValue({
      activeProfile: {
        id: "profile-1",
        name: "Remote",
        origin: "https://demo.test",
      },
      activeToken: "secret",
    });

    render(
      <TrackerClientProvider createClient={createClient} locale="pt-BR">
        <ClientState />
      </TrackerClientProvider>,
    );

    expect(screen.getByText("bound")).toBeTruthy();
    expect(createClient).toHaveBeenCalledWith({
      origin: "https://demo.test",
      token: "secret",
      locale: "pt-BR",
    });
    expect(JSON.stringify(screen.toJSON())).not.toContain("secret");
  });

  it("exposes no client until both profile and token are available", () => {
    const createClient = jest.fn();
    mockUseConnection.mockReturnValue({
      activeProfile: null,
      activeToken: null,
    });

    render(
      <TrackerClientProvider createClient={createClient} locale="pt-BR">
        <ClientState />
      </TrackerClientProvider>,
    );

    expect(screen.getByText("missing")).toBeTruthy();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rebuilds the bound client when the active profile changes", () => {
    const createClient = jest.fn(() => ({}) as TrackerClient);
    mockUseConnection.mockReturnValue({
      activeProfile: {
        id: "profile-1",
        name: "Remote",
        origin: "https://one.test",
      },
      activeToken: "token-one",
    });
    const view = render(
      <TrackerClientProvider createClient={createClient} locale="en">
        <ClientState />
      </TrackerClientProvider>,
    );

    mockUseConnection.mockReturnValue({
      activeProfile: {
        id: "profile-2",
        name: "Local",
        origin: "https://two.test",
      },
      activeToken: "token-two",
    });
    view.rerender(
      <TrackerClientProvider createClient={createClient} locale="en">
        <ClientState />
      </TrackerClientProvider>,
    );

    expect(createClient).toHaveBeenLastCalledWith({
      origin: "https://two.test",
      token: "token-two",
      locale: "en",
    });
  });

  it("connects the selected encrypted host and exposes its live state", () => {
    let callbacks: { onStateChange(state: string): void } | undefined;
    const connect = jest.fn();
    const close = jest.fn();
    const Adapter = jest.requireMock("@/rpc/websocket-adapter")
      .HandshakeWebSocketAdapter as jest.Mock;
    const RpcClient = jest.requireMock("@/rpc/client").RpcClient as jest.Mock;
    Adapter.mockImplementation((_offer, nextCallbacks) => {
      callbacks = nextCallbacks;
      return { close, connect, onMessage: jest.fn(() => jest.fn()), send: jest.fn() };
    });
    RpcClient.mockImplementation(() => ({ close: jest.fn() }));
    const createClient = jest.fn();
    mockUseConnection.mockReturnValue({
      activeProfile: {
        id: "profile-rpc",
        name: "Studio",
        origin: "https://studio.test",
        transport: "rpc",
        hostId: "host-studio",
        endpoint: "wss://studio.test/mobile/rpc",
      },
      activeHostCredential: {
        deviceId: "device-1",
        deviceToken: "device-secret",
        hostPublicKey: "host-public-key",
      },
      activeToken: "device-secret",
    });

    render(
      <TrackerClientProvider createClient={createClient} locale="pt-BR">
        <TransportState />
        <ClientState />
      </TrackerClientProvider>,
    );

    expect(createClient).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(screen.getByText("host-studio:connecting")).toBeTruthy();
    expect(screen.getByText("bound")).toBeTruthy();

    act(() => callbacks?.onStateChange("online"));

    expect(screen.getByText("host-studio:online")).toBeTruthy();
  });
});
