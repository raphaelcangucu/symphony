import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GitDiffLauncher } from "../GitDiffLauncher";

vi.mock("../GitDiffModal", () => ({
  default: ({
    open,
    onOpenChange,
    identifier,
    threadId,
    initialFocusPath,
    initialFocusCommit,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    identifier?: string | null;
    threadId?: number | null;
    initialFocusPath?: string | null;
    initialFocusCommit?: { repo: string; sha: string } | null;
  }) =>
    open ? (
      <div
        role="dialog"
        data-identifier={identifier ?? ""}
        data-thread-id={threadId == null ? "" : String(threadId)}
      >
        diff-modal
        <span data-testid="initial-focus-path">{initialFocusPath ?? ""}</span>
        <span data-testid="initial-focus-commit">
          {initialFocusCommit ? `${initialFocusCommit.repo}:${initialFocusCommit.sha}` : ""}
        </span>
        <button type="button" onClick={() => onOpenChange(false)}>
          close
        </button>
      </div>
    ) : null,
}));

describe("GitDiffLauncher", () => {
  it("opens the modal from the toolbar button", async () => {
    const user = userEvent.setup();
    render(<GitDiffLauncher projectSlug="advising" identifier="CDE-1" />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /diff/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("drops the thread id when an issue identifier is present", async () => {
    const user = userEvent.setup();
    render(
      <GitDiffLauncher
        projectSlug="macro-markets"
        identifier="510"
        threadId={7996}
      />,
    );

    await user.click(screen.getByRole("button", { name: /diff/i }));

    expect(await screen.findByRole("dialog")).toHaveAttribute("data-identifier", "510");
    expect(screen.getByRole("dialog")).toHaveAttribute("data-thread-id", "");
  });

  it("opens on Ctrl+G when not typing into an input", async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="Composer" />
        <GitDiffLauncher projectSlug="advising" identifier="CDE-1" />
      </>,
    );

    await user.click(screen.getByLabelText("Composer"));
    await user.keyboard("{Control>}g{/Control}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.tab();
    await user.keyboard("{Control>}g{/Control}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens from openRequestId without a visible trigger", async () => {
    const { rerender } = render(
      <GitDiffLauncher projectSlug="advising" identifier="CDE-1" showTrigger={false} openRequestId={0} />,
    );

    expect(screen.queryByRole("button", { name: /diff/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <GitDiffLauncher projectSlug="advising" identifier="CDE-1" showTrigger={false} openRequestId={1} />,
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens from focusPathRequestId and forwards initialFocusPath", async () => {
    const { rerender } = render(
      <GitDiffLauncher
        projectSlug="advising"
        identifier="CDE-1"
        showTrigger={false}
        focusPathRequestId={0}
        focusPath={null}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <GitDiffLauncher
        projectSlug="advising"
        identifier="CDE-1"
        showTrigger={false}
        focusPathRequestId={1}
        focusPath="docs/index.md"
      />,
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("initial-focus-path")).toHaveTextContent("docs/index.md");
  });

  it("opens from focusCommitRequestId and forwards initialFocusCommit", async () => {
    const { rerender } = render(
      <GitDiffLauncher
        projectSlug="advising"
        identifier="CDE-1"
        showTrigger={false}
        focusCommitRequestId={0}
        focusCommit={null}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <GitDiffLauncher
        projectSlug="advising"
        identifier="CDE-1"
        showTrigger={false}
        focusCommitRequestId={1}
        focusCommit={{ repo: "advising", sha: "abc123def456" }}
      />,
    );

    expect(await screen.findByTestId("initial-focus-commit")).toHaveTextContent(
      "advising:abc123def456",
    );
  });
});
