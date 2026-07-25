import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import type { TrackerClient } from "./contracts";
import { TrackerClientProvider, useTrackerClient } from "./TrackerClientProvider";

const mockUseConnection = jest.fn();

jest.mock("@/auth/ConnectionProvider", () => ({
  useConnection: () => mockUseConnection(),
}));

function ClientState() {
  const client = useTrackerClient();
  return <Text>{client ? "bound" : "missing"}</Text>;
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
});
