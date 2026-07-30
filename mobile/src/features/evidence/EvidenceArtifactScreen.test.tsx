import { fireEvent, render, screen } from "@testing-library/react-native";

import { ThemeProvider } from "@/theme/ThemeProvider";

import type { EvidenceArtifact } from "./evidence-contract";
import { EvidenceArtifactScreen } from "./EvidenceArtifactScreen";

describe("EvidenceArtifactScreen", () => {
  it("renders native image, video, report, and trace viewers", () => {
    const onShare = jest.fn();
    const { rerender } = renderScreen({
      artifact: artifact("image", "home.png"),
      download: ready("file:///home.png"),
      onShare,
    });
    expect(screen.getByLabelText("Evidence image")).toBeTruthy();

    rerenderScreen(rerender, {
      artifact: artifact("video", "flow.mp4"),
      download: ready("file:///flow.mp4"),
      onShare,
    });
    expect(screen.getByLabelText("Evidence video")).toBeTruthy();

    rerenderScreen(rerender, {
      artifact: artifact("report", "report.md"),
      download: { ...ready("file:///report.md"), text: "# Verified\n\nAll checks passed." },
      onShare,
    });
    expect(screen.getByText("# Verified\n\nAll checks passed.")).toBeTruthy();

    rerenderScreen(rerender, {
      artifact: artifact("trace", "trace.zip"),
      download: ready("file:///trace.zip"),
      onShare,
    });
    expect(screen.getByText("Playwright trace archive")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Share trace" }));
    expect(onShare).toHaveBeenCalledWith("file:///trace.zip");
  });

  it("shows encrypted download progress, retry, and offline cached state", () => {
    const onRetry = jest.fn();
    const { rerender } = renderScreen({
      artifact: artifact("image", "home.png"),
      download: { status: "loading", uri: null, text: null, error: null, cached: false },
      onRetry,
    });
    expect(screen.getByText("Downloading encrypted evidence…")).toBeTruthy();

    rerenderScreen(rerender, {
      artifact: artifact("image", "home.png"),
      download: {
        status: "error",
        uri: null,
        text: null,
        error: "Host is offline",
        cached: false,
      },
      onRetry,
    });
    fireEvent.press(screen.getByRole("button", { name: "Retry evidence download" }));
    expect(onRetry).toHaveBeenCalled();

    rerenderScreen(rerender, {
      artifact: artifact("image", "home.png"),
      download: { ...ready("file:///home.png"), cached: true },
      onRetry,
    });
    expect(screen.getByText("Offline · cached on this device")).toBeTruthy();
  });
});

function renderScreen(
  overrides: Partial<React.ComponentProps<typeof EvidenceArtifactScreen>> = {},
) {
  const props = screenProps(overrides);
  return render(
    <ThemeProvider colorScheme="dark">
      <EvidenceArtifactScreen {...props} />
    </ThemeProvider>,
  );
}

function rerenderScreen(
  rerender: ReturnType<typeof render>["rerender"],
  overrides: Partial<React.ComponentProps<typeof EvidenceArtifactScreen>>,
) {
  rerender(
    <ThemeProvider colorScheme="dark">
      <EvidenceArtifactScreen {...screenProps(overrides)} />
    </ThemeProvider>,
  );
}

function screenProps(
  overrides: Partial<React.ComponentProps<typeof EvidenceArtifactScreen>>,
): React.ComponentProps<typeof EvidenceArtifactScreen> {
  return {
    artifact: artifact("image", "home.png"),
    download: ready("file:///home.png"),
    onBack: jest.fn(),
    onRetry: jest.fn(),
    onShare: jest.fn(),
    ...overrides,
  };
}

function artifact(kind: EvidenceArtifact["kind"], path: string): EvidenceArtifact {
  return { kind, path: `artifacts/${path}`, label: path, navigations: [] };
}

function ready(uri: string) {
  return {
    status: "ready" as const,
    uri,
    text: null,
    error: null,
    cached: false,
  };
}
