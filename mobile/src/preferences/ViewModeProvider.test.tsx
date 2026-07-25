import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { ViewModeProvider, useViewMode } from "./ViewModeProvider";
import type { ViewModeKeyValueStorage } from "./view-mode";

function PreferenceProbe() {
  const { hydrated, mode, setMode } = useViewMode();
  return (
    <>
      <Text>{hydrated ? mode : "loading"}</Text>
      <Pressable accessibilityRole="button" onPress={() => void setMode("codex")}>
        <Text>Use compact sessions</Text>
      </Pressable>
    </>
  );
}

describe("ViewModeProvider", () => {
  it("hydrates and changes one device-wide preference without transport side effects", async () => {
    const values = new Map<string, string>();
    const storage: ViewModeKeyValueStorage = {
      getItem: jest.fn(async (key) => values.get(key) ?? null),
      setItem: jest.fn(async (key, value) => void values.set(key, value)),
    };

    render(
      <ViewModeProvider storage={storage}>
        <PreferenceProbe />
      </ViewModeProvider>,
    );

    await waitFor(() => expect(screen.getByText("orca")).toBeTruthy());
    fireEvent.press(screen.getByRole("button", { name: "Use compact sessions" }));
    await waitFor(() => expect(screen.getByText("codex")).toBeTruthy());
    expect(storage.setItem).toHaveBeenCalledWith("dev10x:mobile:view-mode", "codex");
  });
});
