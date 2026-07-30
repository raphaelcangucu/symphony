import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import type { HostTransport } from "@/transport/HostTransport";
import type { TrackerClient } from "./contracts";
import {
  TrackerClientProvider,
  useHostTransportState,
  useTrackerClient,
} from "./TrackerClientProvider";

const mockUseConnection = jest.fn();
const mockUseHostRuntime = jest.fn();

jest.mock("@/auth/ConnectionProvider", () => ({
  useConnection: () => mockUseConnection(),
}));
jest.mock("@/runtime/HostRuntimeProvider", () => ({
  useHostRuntime: () => mockUseHostRuntime(),
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
  beforeEach(() => {
    mockUseHostRuntime.mockReturnValue({
      selectedHostId: null,
      selectHost: jest.fn(),
      transport: jest.fn(() => null),
      state: jest.fn((hostId: string) => ({
        hostId,
        status: "offline",
        error: null,
        missedHeartbeats: 0,
        lastHeartbeatAt: null,
        failureCode: null,
        reconnectAttempt: 0,
        reconnectTimer: null,
      })),
      subscribe: jest.fn(() => () => undefined),
    });
  });

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

  it("consumes the selected encrypted transport without taking ownership of it", () => {
    const transport: HostTransport = {
      hostId: "host-studio",
      call: jest.fn(),
      subscribe: jest.fn(async () => () => undefined),
      reconnect: jest.fn(),
      deactivate: jest.fn(),
      close: jest.fn(),
    };
    let status = "connecting";
    mockUseHostRuntime.mockReturnValue({
      selectedHostId: "host-studio",
      selectHost: jest.fn(),
      transport: jest.fn(() => transport),
      state: jest.fn((hostId: string) => ({
        hostId,
        status,
        error: null,
        missedHeartbeats: 0,
        lastHeartbeatAt: null,
        failureCode: null,
        reconnectAttempt: 0,
        reconnectTimer: null,
      })),
      subscribe: jest.fn(() => () => undefined),
    });
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
      activeToken: "device-secret",
    });

    const view = render(
      <TrackerClientProvider createClient={createClient} locale="pt-BR">
        <TransportState />
        <ClientState />
      </TrackerClientProvider>,
    );

    expect(createClient).not.toHaveBeenCalled();
    expect(screen.getByText("host-studio:connecting")).toBeTruthy();
    expect(screen.getByText("bound")).toBeTruthy();

    status = "online";
    view.rerender(
      <TrackerClientProvider createClient={createClient} locale="pt-BR">
        <TransportState />
        <ClientState />
      </TrackerClientProvider>,
    );
    expect(screen.getByText("host-studio:online")).toBeTruthy();

    view.unmount();
    expect(transport.close).not.toHaveBeenCalled();
  });
});
