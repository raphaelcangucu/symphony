import { fireEvent, render, screen } from "@testing-library/react-native";

import { ThemeProvider } from "@/theme/ThemeProvider";

import { TerminalScreen } from "./TerminalScreen";

describe("TerminalScreen", () => {
  it("renders live output and sends commands and control input", () => {
    const onInput = jest.fn();
    render(
      <ThemeProvider colorScheme="dark">
        <TerminalScreen
          connectionState="live"
          error={null}
          onBack={jest.fn()}
          onInput={onInput}
          onReconnect={jest.fn()}
          output={"$ npm test\n12 passed\n"}
          threadId={42}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("$ npm test\n12 passed\n")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Terminal command"), "git status");
    fireEvent.press(screen.getByRole("button", { name: "Run command" }));
    fireEvent.press(screen.getByRole("button", { name: "Send Control C" }));

    expect(onInput).toHaveBeenNthCalledWith(1, "git status\n");
    expect(onInput).toHaveBeenNthCalledWith(2, "\u0003");
    expect(screen.getByLabelText("Terminal command")).toHaveProp("value", "");
  });

  it("shows an explicit reconnect action while offline", () => {
    const onReconnect = jest.fn();
    render(
      <ThemeProvider colorScheme="dark">
        <TerminalScreen
          connectionState="offline"
          error="Terminal disconnected"
          onBack={jest.fn()}
          onInput={jest.fn()}
          onReconnect={onReconnect}
          output=""
          threadId={42}
        />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByRole("button", { name: "Reconnect terminal" }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});
