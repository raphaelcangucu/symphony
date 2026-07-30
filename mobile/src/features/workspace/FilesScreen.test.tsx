import { fireEvent, render, screen } from "@testing-library/react-native";

import { ThemeProvider } from "@/theme/ThemeProvider";

import { FilesScreen } from "./FilesScreen";

describe("FilesScreen", () => {
  it("searches documents and opens a selected source preview", () => {
    const onOpenDocument = jest.fn();
    render(
      <ThemeProvider colorScheme="dark">
        <FilesScreen
          files={[
            {
              id: "docs/plan.md",
              kind: "markdown",
              path: "docs/plan.md",
              name: "plan.md",
              title: "Mobile plan",
              size: 24,
              updatedAt: null,
            },
            {
              id: "README.md",
              kind: "markdown",
              path: "README.md",
              name: "README.md",
              title: "Readme",
              size: 10,
              updatedAt: null,
            },
          ]}
          error={null}
          loading={false}
          onBack={jest.fn()}
          onOpenDocument={onOpenDocument}
          onRefresh={jest.fn()}
          preview={{
            path: "docs/plan.md",
            kind: "markdown",
            mimeType: "text/markdown",
            content: "# Mobile plan\n\nShip it.",
            dataUri: null,
          }}
          selectedPath="docs/plan.md"
        />
      </ThemeProvider>,
    );

    expect(screen.getByText(/Ship it/)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Search files"), "readme");
    expect(screen.queryByRole("button", { name: "Open file docs/plan.md" })).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Open file README.md" }));
    expect(onOpenDocument).toHaveBeenCalledWith("README.md");
  });

  it("renders an image preview without exposing transport credentials", () => {
    render(
      <ThemeProvider colorScheme="dark">
        <FilesScreen
          error={null}
          files={[
            {
              id: "assets/icon.png",
              kind: "image",
              path: "assets/icon.png",
              name: "icon.png",
              title: "icon.png",
              size: 68,
              updatedAt: null,
            },
          ]}
          loading={false}
          onBack={jest.fn()}
          onOpenDocument={jest.fn()}
          onRefresh={jest.fn()}
          preview={{
            path: "assets/icon.png",
            kind: "image",
            mimeType: "image/png",
            content: null,
            dataUri: "data:image/png;base64,iVBORw0KGgo=",
          }}
          selectedPath="assets/icon.png"
        />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText("Preview image assets/icon.png")).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).not.toContain("Bearer");
  });
});
