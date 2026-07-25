import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { TrackerAuthError } from "@/api/errors";
import { AppRuntimeProvider, productionRuntime, type AppRuntime } from "@/runtime/AppRuntime";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { ConnectScreen } from "./ConnectScreen";

const mockSaveProfile = jest.fn();

jest.mock("@/auth/ConnectionProvider", () => ({
  useConnection: () => ({
    saveProfile: mockSaveProfile,
  }),
}));

function renderScreen(props: Partial<React.ComponentProps<typeof ConnectScreen>> = {}) {
  return render(
    <ThemeProvider colorScheme="dark">
      <ConnectScreen onConnected={jest.fn()} {...props} />
    </ThemeProvider>,
  );
}

function fillValidForm() {
  fireEvent.changeText(screen.getByLabelText("Connection name"), "Remote");
  fireEvent.changeText(screen.getByLabelText("Tracker URL"), "https://demo.test/tracker");
  fireEvent.changeText(screen.getByLabelText("Tracker token"), "secret-token");
}

describe("ConnectScreen", () => {
  beforeEach(() => {
    mockSaveProfile.mockReset();
    mockSaveProfile.mockResolvedValue({ id: "profile-1" });
  });

  it("keeps Connect disabled until every field is present", () => {
    const validateConnection = jest.fn();
    renderScreen({ validateConnection });

    fireEvent.press(screen.getByRole("button", { name: "Connect" }));

    expect(validateConnection).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Tracker token").props.secureTextEntry).toBe(true);
  });

  it("validates the normalized connection before saving", async () => {
    const validateConnection = jest.fn().mockResolvedValue({
      health: { status: "ok" },
      viewer: { id: "viewer-1", name: "Raphael" },
    });
    const onConnected = jest.fn();
    renderScreen({ validateConnection, onConnected });
    fillValidForm();

    fireEvent.press(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(validateConnection).toHaveBeenCalledWith({
        origin: "https://demo.test",
        token: "secret-token",
      }),
    );
    expect(mockSaveProfile).toHaveBeenCalledWith({
      name: "Remote",
      origin: "https://demo.test",
      token: "secret-token",
    });
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("uses the injected runtime client for default connection validation", async () => {
    const health = jest.fn().mockResolvedValue({ status: "ok" });
    const viewer = jest.fn().mockResolvedValue({ id: "viewer-1", name: "Raphael" });
    const createTrackerClient = jest.fn(() => ({ health, viewer }));
    const onConnected = jest.fn();

    render(
      <AppRuntimeProvider
        runtime={{
          ...productionRuntime,
          createTrackerClient: createTrackerClient as unknown as AppRuntime["createTrackerClient"],
        }}
      >
        <ThemeProvider colorScheme="dark">
          <ConnectScreen onConnected={onConnected} />
        </ThemeProvider>
      </AppRuntimeProvider>,
    );
    fillValidForm();

    fireEvent.press(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(createTrackerClient).toHaveBeenCalledWith({
        origin: "https://demo.test",
        token: "secret-token",
        locale: expect.any(String),
      }),
    );
    expect(health).toHaveBeenCalledTimes(1);
    expect(viewer).toHaveBeenCalledTimes(1);
    expect(mockSaveProfile).toHaveBeenCalledTimes(1);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("renders URL and authentication failures without exposing the token", async () => {
    const validateConnection = jest
      .fn()
      .mockRejectedValue(new TrackerAuthError("Bearer secret-token is invalid"));
    renderScreen({ validateConnection });

    fireEvent.changeText(screen.getByLabelText("Connection name"), "Remote");
    fireEvent.changeText(screen.getByLabelText("Tracker URL"), "not-a-url");
    fireEvent.changeText(screen.getByLabelText("Tracker token"), "secret-token");
    fireEvent.press(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText("Only http and https tracker URLs are supported")).toBeTruthy();
    expect(validateConnection).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByLabelText("Tracker URL"), "https://demo.test");
    fireEvent.press(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText("Invalid tracker token")).toBeTruthy();
    expect(screen.queryByText(/secret-token/)).toBeNull();
  });

  it("ignores a second submission while validation is pending", async () => {
    let resolveValidation:
      | ((value: { health: { status: string }; viewer: { id: string; name: string } }) => void)
      | undefined;
    const validateConnection = jest.fn(
      () =>
        new Promise<{
          health: { status: string };
          viewer: { id: string; name: string };
        }>((resolve) => {
          resolveValidation = resolve;
        }),
    );
    renderScreen({ validateConnection });
    fillValidForm();

    const connectButton = screen.getByRole("button", { name: "Connect" });
    fireEvent.press(connectButton);
    fireEvent.press(connectButton);

    expect(validateConnection).toHaveBeenCalledTimes(1);

    resolveValidation?.({
      health: { status: "ok" },
      viewer: { id: "viewer-1", name: "Raphael" },
    });
    await waitFor(() => expect(mockSaveProfile).toHaveBeenCalledTimes(1));
  });
});
