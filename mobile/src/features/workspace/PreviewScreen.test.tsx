import { fireEvent, render, screen } from "@testing-library/react-native";

import { ThemeProvider } from "@/theme/ThemeProvider";

import { PreviewScreen } from "./PreviewScreen";

jest.mock("react-native-webview", () => {
  const { View } = jest.requireActual("react-native");
  return { WebView: View };
});

describe("PreviewScreen", () => {
  it("renders the ready public preview inside the app", () => {
    render(
      <ThemeProvider colorScheme="dark">
        <PreviewScreen
          error={null}
          loading={false}
          onBack={jest.fn()}
          onRestart={jest.fn()}
          onStart={jest.fn()}
          server={{
            id: 7,
            slug: "app",
            url: "http://127.0.0.1:4000",
            localUrl: "http://127.0.0.1:4000",
            publicUrl: "https://preview.example.test",
            status: "ready",
            primary: true,
          }}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("workspace-preview")).toHaveProp("source", {
      uri: "https://preview.example.test",
    });
    expect(screen.getByText("https://preview.example.test")).toBeTruthy();
  });

  it("starts unavailable previews and restarts failed previews", () => {
    const onStart = jest.fn();
    const onRestart = jest.fn();
    const view = render(
      <ThemeProvider colorScheme="dark">
        <PreviewScreen
          error={null}
          loading={false}
          onBack={jest.fn()}
          onRestart={onRestart}
          onStart={onStart}
          server={null}
        />
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByRole("button", { name: "Start preview" }));
    expect(onStart).toHaveBeenCalledTimes(1);

    view.rerender(
      <ThemeProvider colorScheme="dark">
        <PreviewScreen
          error="Preview crashed"
          loading={false}
          onBack={jest.fn()}
          onRestart={onRestart}
          onStart={onStart}
          server={{
            id: 7,
            slug: "app",
            url: null,
            localUrl: null,
            publicUrl: null,
            status: "crashed",
            primary: true,
          }}
        />
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByRole("button", { name: "Restart preview" }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
