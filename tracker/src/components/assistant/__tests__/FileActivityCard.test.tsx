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
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("hello body")).toBeInTheDocument();
  });

  it("shows a running indicator", () => {
    renderWithI18n(<FileActivityCard view={view({ status: "running" })} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
  });
});
