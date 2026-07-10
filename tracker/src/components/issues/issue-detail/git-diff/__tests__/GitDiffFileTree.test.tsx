import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GitDiffFileTree } from "../GitDiffFileTree";
import type { GitDiffFileChange } from "@/types/gitDiff";

const files: GitDiffFileChange[] = [
  { path: "frontend/src/App.tsx", oldPath: null, patch: "@@\n+a\n+b\n", status: "modified" },
  { path: "frontend/README.md", oldPath: null, patch: "@@\n-old\n", status: "modified" },
  { path: "backend/tests/CashHuntResultTest.php", oldPath: null, patch: "@@\n+test\n", status: "added" },
];

describe("GitDiffFileTree", () => {
  it("renders a compact tree and selects files", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <GitDiffFileTree
        files={files}
        flat={false}
        selectedPath={null}
        onSelect={onSelect}
        onToggleFlat={vi.fn()}
      />,
    );

    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("frontend")).toBeInTheDocument();
    expect(screen.getByText("src")).toBeInTheDocument();
    await user.click(screen.getByText("App.tsx"));
    expect(onSelect).toHaveBeenCalledWith(files[0]);
  });

  it("renders full paths in flat mode and exposes the tree toggle", async () => {
    const onToggleFlat = vi.fn();
    const user = userEvent.setup();

    render(
      <GitDiffFileTree
        files={files}
        flat
        selectedPath={null}
        onSelect={vi.fn()}
        onToggleFlat={onToggleFlat}
      />,
    );

    expect(screen.getByText("frontend/src/App.tsx")).toBeInTheDocument();
    expect(screen.getByText("frontend/README.md")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /tree/i }));
    expect(onToggleFlat).toHaveBeenCalledTimes(1);
  });

  it("filters files by path and renders file-type icons", async () => {
    const user = userEvent.setup();

    render(
      <GitDiffFileTree
        files={files}
        flat
        selectedPath={null}
        onSelect={vi.fn()}
        onToggleFlat={vi.fn()}
      />,
    );

    await user.type(screen.getByPlaceholderText(/filter/i), "cash");

    expect(screen.getByText("backend/tests/CashHuntResultTest.php")).toBeInTheDocument();
    expect(screen.queryByText("frontend/src/App.tsx")).not.toBeInTheDocument();
    expect(screen.getByLabelText("php file")).toBeInTheDocument();
  });

  it("shows a comment badge count for paths with comments", () => {
    render(
      <GitDiffFileTree
        files={files}
        flat
        selectedPath={null}
        onSelect={vi.fn()}
        onToggleFlat={vi.fn()}
        commentCountsByPath={{ "frontend/src/App.tsx": 2 }}
      />,
    );

    expect(screen.getByText("💬2")).toBeInTheDocument();
  });
});
