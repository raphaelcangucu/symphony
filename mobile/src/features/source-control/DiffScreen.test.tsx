import { fireEvent, render, screen } from "@testing-library/react-native";
import { Alert } from "react-native";

import type { GitDiffFileEntry, GitDiffPatchResult } from "@/api/contracts";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { DiffScreen } from "./DiffScreen";

const file: GitDiffFileEntry = {
  repo: "mobile",
  path: "src/App.tsx",
  oldPath: null,
  status: "modified",
  additions: 4,
  deletions: 1,
  binary: false,
};

const patch: GitDiffPatchResult = {
  ...file,
  truncated: false,
  patch: "@@ -1 +1 @@\n-old\n+new",
  workspace: { path: "/tmp/mobile", available: true },
};

function renderScreen(overrides: Partial<React.ComponentProps<typeof DiffScreen>> = {}) {
  const props: React.ComponentProps<typeof DiffScreen> = {
    actionError: false,
    actionMessage: null,
    busy: false,
    error: null,
    files: [file],
    hasMore: true,
    loading: false,
    onBack: jest.fn(),
    onCommit: jest.fn(),
    onLoadMore: jest.fn(),
    onOpenFile: jest.fn(),
    onPush: jest.fn(),
    onRefresh: jest.fn(),
    patch: null,
    selectedFile: null,
    stats: [
      {
        repo: "mobile",
        branch: "agent/mobile",
        base: "main",
        filesChanged: 1,
        additions: 4,
        deletions: 1,
        untracked: 0,
      },
    ],
    ...overrides,
  };
  return {
    props,
    ...render(
      <ThemeProvider colorScheme="dark">
        <DiffScreen {...props} />
      </ThemeProvider>,
    ),
  };
}

describe("DiffScreen", () => {
  afterEach(() => jest.restoreAllMocks());

  it("shows repository stats and requests a patch only when a file is opened", () => {
    const onOpenFile = jest.fn();
    const onLoadMore = jest.fn();
    renderScreen({ onLoadMore, onOpenFile });

    expect(screen.getByText("agent/mobile → main")).toBeTruthy();
    expect(screen.getAllByText("+4")).toHaveLength(2);
    expect(screen.queryByText("-old")).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Open diff mobile src/App.tsx" }));
    expect(onOpenFile).toHaveBeenCalledWith(file);
    fireEvent.press(screen.getByRole("button", { name: "Load more files" }));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it("renders semantic patch lines and confirms commit and push actions", () => {
    const onCommit = jest.fn();
    const onPush = jest.fn();
    const alert = jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === "Push")?.onPress?.();
    });
    renderScreen({ onCommit, onPush, patch, selectedFile: file });

    expect(screen.getByText("-old")).toBeTruthy();
    expect(screen.getByText("+new")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Commit changes" }));
    fireEvent.changeText(screen.getByLabelText("Commit message"), "feat: mobile diff");
    fireEvent.press(screen.getByRole("button", { name: "Confirm commit" }));
    expect(onCommit).toHaveBeenCalledWith("feat: mobile diff");

    fireEvent.press(screen.getByRole("button", { name: "Push commits" }));
    expect(alert).toHaveBeenCalledWith(
      "Push commits?",
      expect.stringContaining("remote"),
      expect.any(Array),
    );
    expect(onPush).toHaveBeenCalled();
  });
});
