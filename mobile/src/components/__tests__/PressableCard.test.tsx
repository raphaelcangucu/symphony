import { fireEvent, render } from "@testing-library/react-native";
import { Text } from "react-native";

import { ConnectionBadge } from "@/components/ConnectionBadge";
import { PressableCard } from "@/components/PressableCard";
import { StateView } from "@/components/StateView";
import { ThemeProvider } from "@/theme/ThemeProvider";

function renderWithTheme(element: React.ReactElement) {
  return render(<ThemeProvider colorScheme="dark">{element}</ThemeProvider>);
}

describe("shared mobile primitives", () => {
  it("exposes an accessible button and handles presses", () => {
    const onPress = jest.fn();
    const screen = renderWithTheme(
      <PressableCard accessibilityLabel="Open project Symphony" onPress={onPress}>
        <Text>Symphony</Text>
      </PressableCard>,
    );

    fireEvent.press(screen.getByRole("button", { name: "Open project Symphony" }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["live", "Live"],
    ["connecting", "Connecting"],
    ["cached", "Cached"],
    ["offline", "Offline"],
  ] as const)("renders the %s state as text in addition to color", (state, label) => {
    const screen = renderWithTheme(<ConnectionBadge state={state} />);

    expect(screen.getByText(label)).toBeTruthy();
  });

  it("renders loading, empty, and error presentations accessibly", () => {
    const loading = renderWithTheme(<StateView kind="loading" title="Loading projects" />);
    expect(loading.getByRole("progressbar")).toBeTruthy();
    loading.unmount();

    const empty = renderWithTheme(
      <StateView
        actionLabel="Refresh"
        description="Create a project in the tracker to get started."
        kind="empty"
        onAction={jest.fn()}
        title="No projects yet"
      />,
    );
    expect(empty.getByText("No projects yet")).toBeTruthy();
    expect(empty.getByRole("button", { name: "Refresh" })).toBeTruthy();
    empty.unmount();

    const error = renderWithTheme(
      <StateView
        description="Check the connection and try again."
        kind="error"
        title="Could not load"
      />,
    );
    expect(error.getByRole("alert")).toBeTruthy();
  });
});
