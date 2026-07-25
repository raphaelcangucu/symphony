import { fireEvent, render, screen } from "@testing-library/react-native";

import { ThemeProvider } from "@/theme/ThemeProvider";

import { FilesScreen } from "./FilesScreen";

describe("FilesScreen", () => {
  it("searches documents and opens a selected source preview", () => {
    const onOpenDocument = jest.fn();
    render(
      <ThemeProvider colorScheme="dark">
        <FilesScreen
          content="# Mobile plan\n\nShip it."
          documents={[
            {
              id: "docs/plan.md",
              kind: "draft",
              path: "docs/plan.md",
              title: "Mobile plan",
              updatedAt: null,
            },
            {
              id: "README.md",
              kind: "draft",
              path: "README.md",
              title: "Readme",
              updatedAt: null,
            },
          ]}
          error={null}
          loading={false}
          onBack={jest.fn()}
          onOpenDocument={onOpenDocument}
          onRefresh={jest.fn()}
          selectedPath="docs/plan.md"
        />
      </ThemeProvider>,
    );

    expect(screen.getByText(/Ship it/)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Search files"), "readme");
    expect(screen.queryByText("Mobile plan")).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Open file README.md" }));
    expect(onOpenDocument).toHaveBeenCalledWith("README.md");
  });
});
