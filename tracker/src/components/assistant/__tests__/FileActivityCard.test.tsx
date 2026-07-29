import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { FileActivityCard } from "@/components/assistant/FileActivityCard";
import type { FileActivityView } from "@/components/assistant/fileActivity";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";

function view(partial: Partial<FileActivityView>): FileActivityView {
  return {
    kind: "read",
    title: "front/README.md",
    path: "front/README.md",
    lineRange: "L1–60",
    additions: null,
    deletions: null,
    status: "complete",
    body: null,
    ...partial,
  };
}

describe("FileActivityCard", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("renders a read header with line range", () => {
    renderWithI18n(<FileActivityCard view={view({})} />);
    expect(screen.getByText("front/README.md")).toBeInTheDocument();
    expect(screen.getByText("L1–60")).toBeInTheDocument();
  });

  it("renders edit add/remove counts", () => {
    renderWithI18n(
      <FileActivityCard view={view({ kind: "edit", title: "lib/foo.ex", path: "lib/foo.ex", lineRange: null, additions: 12, deletions: 3 })} />,
    );
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.getByText("−3")).toBeInTheDocument();
  });

  it("is collapsed by default and expands the body on click", () => {
    renderWithI18n(<FileActivityCard view={view({ body: { value: "hello body", language: "text" } })} />);
    expect(screen.queryByText("hello body")).not.toBeInTheDocument();
    const summary = screen.getByRole("button");
    expect(summary).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(summary);
    expect(screen.getByText("hello body")).toBeInTheDocument();
  });

  it("does not render a dead toggle without detail content", () => {
    renderWithI18n(<FileActivityCard view={view({ body: null })} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("front/README.md").closest("[aria-expanded]")).toBeNull();
  });

  it("keeps running output closed and exposes busy status", () => {
    renderWithI18n(
      <FileActivityCard
        view={view({
          status: "running",
          body: { value: "partial output", language: "text" },
        })}
      />,
    );

    const summary = screen.getByRole("button", { name: /running/i });
    expect(summary).toHaveAttribute("aria-busy", "true");
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("partial output")).not.toBeInTheDocument();
  });

  it("uses a single progressive verb for a running command", () => {
    renderWithI18n(
      <FileActivityCard
        view={view({
          kind: "command",
          title: "sleep 10",
          status: "running",
        })}
      />,
    );

    expect(screen.getAllByText("Running")).toHaveLength(1);
    expect(screen.queryByText("Ran")).not.toBeInTheDocument();
  });

  it("uses a completed verb for a settled command", () => {
    renderWithI18n(
      <FileActivityCard
        view={view({
          kind: "command",
          title: "sleep 10",
          status: "complete",
        })}
      />,
    );

    expect(screen.getByText("Ran")).toBeInTheDocument();
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });

  it("keeps failed output closed and makes failure obvious", () => {
    renderWithI18n(
      <FileActivityCard
        view={view({
          status: "error",
          body: { value: "permission denied", language: "text" },
        })}
      />,
    );

    expect(screen.getByText("failed")).toHaveClass("text-destructive");
    expect(screen.queryByText("permission denied")).not.toBeInTheDocument();
  });

  it("preserves diff colors after expansion", () => {
    renderWithI18n(
      <FileActivityCard
        view={view({
          kind: "edit",
          body: {
            value: "@@ -1 +1 @@\n-removed\n+added",
            language: "diff",
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("+added")).toHaveClass("text-emerald-300");
    expect(screen.getByText("-removed")).toHaveClass("text-rose-300");
  });
});
