import { fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

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
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <ThemeProvider colorScheme="dark">
        <NotificationsScreen {...defaults} {...props} />
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe("NotificationsScreen", () => {
  it("tests and disables registered device notifications", () => {
    const onDisable = jest.fn();
    const onSendTest = jest.fn();
    renderScreen({ onDisable, onSendTest, state: "registered" });

    expect(screen.getByText("Push Notifications")).toBeTruthy();
    fireEvent(screen.getByLabelText("Push notifications"), "valueChange", false);
    fireEvent.press(screen.getByRole("button", { name: "Send test notification" }));

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

    expect(screen.getByText("Notifications are disabled in system settings.")).toBeTruthy();
    expect(screen.getByText("Notifications are blocked by the device.")).toBeTruthy();
    expect(screen.getByText("Last opened: /issue/symphony/MOB-7")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Open device settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
