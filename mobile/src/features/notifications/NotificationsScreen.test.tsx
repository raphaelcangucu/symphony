import { fireEvent, render, screen } from "@testing-library/react-native";

import { ThemeProvider } from "@/theme/ThemeProvider";

import { NotificationsScreen } from "./NotificationsScreen";

function renderScreen(props: Partial<React.ComponentProps<typeof NotificationsScreen>> = {}) {
  const defaults: React.ComponentProps<typeof NotificationsScreen> = {
    busy: false,
    lastRoute: null,
    message: null,
    onBack: jest.fn(),
    onDisable: jest.fn(),
    onEnable: jest.fn(),
    onOpenSettings: jest.fn(),
    onSendTest: jest.fn(),
    state: "inactive",
  };
  return render(
    <ThemeProvider colorScheme="dark">
      <NotificationsScreen {...defaults} {...props} />
    </ThemeProvider>,
  );
}

describe("NotificationsScreen", () => {
  it("registers, tests and disables device notifications", () => {
    const onEnable = jest.fn();
    const onDisable = jest.fn();
    const onSendTest = jest.fn();
    renderScreen({ onDisable, onEnable, onSendTest, state: "registered" });

    expect(screen.getByText("Device notifications")).toBeTruthy();
    expect(screen.getByText("Registered")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Enable notifications" }));
    fireEvent.press(screen.getByRole("button", { name: "Send test notification" }));
    fireEvent.press(screen.getByRole("button", { name: "Disable notifications" }));

    expect(onEnable).toHaveBeenCalledTimes(1);
    expect(onSendTest).toHaveBeenCalledTimes(1);
    expect(onDisable).toHaveBeenCalledTimes(1);
  });

  it("offers device settings after denial and shows the last safe deep link", () => {
    const onOpenSettings = jest.fn();
    renderScreen({
      lastRoute: "/issue/symphony/MOB-7",
      message: "Notifications are blocked by the device.",
      onOpenSettings,
      state: "denied",
    });

    expect(screen.getByText("Permission denied")).toBeTruthy();
    expect(screen.getByText("Notifications are blocked by the device.")).toBeTruthy();
    expect(screen.getByText("/issue/symphony/MOB-7")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Open device settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
