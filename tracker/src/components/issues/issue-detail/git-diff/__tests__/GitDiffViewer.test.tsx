import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GitDiffViewer } from "../GitDiffViewer";

const fileDiffMock = vi.hoisted(() => vi.fn());
const parsePatchFilesMock = vi.hoisted(() => vi.fn());

vi.mock("@pierre/diffs", () => ({
  parsePatchFiles: (...args: unknown[]) => parsePatchFilesMock(...args),
}));

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: (props: { fileDiff: unknown; options?: { diffStyle?: string }; className?: string }) => {
    fileDiffMock(props);
    return <div data-testid="pierre-file-diff" className={props.className} data-diff-style={props.options?.diffStyle ?? ""} />;
  },
}));

describe("GitDiffViewer", () => {
  it("parses a patch and renders @pierre/diffs with split style", () => {
    const parsedFile = { name: "src/App.tsx", hunks: [] };
    parsePatchFilesMock.mockReturnValue([{ files: [parsedFile] }]);

    render(
      <GitDiffViewer
        file={{ path: "src/App.tsx", oldPath: null, status: "modified", patch: "@@ -1 +1 @@\n-a\n+b\n" }}
        viewMode="split"
      />,
    );

    expect(parsePatchFilesMock).toHaveBeenCalledWith("@@ -1 +1 @@\n-a\n+b\n", "src/App.tsx");
    expect(screen.getByTestId("pierre-file-diff")).toHaveAttribute("data-diff-style", "split");
    expect(screen.getByTestId("pierre-file-diff")).toHaveClass("bg-white");
    expect(fileDiffMock).toHaveBeenCalledWith(expect.objectContaining({ fileDiff: parsedFile }));
  });

  it("renders raw patch text when parsing returns no file", () => {
    parsePatchFilesMock.mockReturnValue([{ files: [] }]);

    render(
      <GitDiffViewer file={{ path: "x.txt", oldPath: null, status: "added", patch: "raw patch text" }} viewMode="unified" />,
    );

    expect(screen.getByText("raw patch text")).toBeInTheDocument();
  });
});
