import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolCallBlock, type ToolCallView } from "@/components/shared/ToolCallBlock";

const baseView: ToolCallView = {
  toolType: "Bash",
  description: "Pint and commit B1",
  status: "completed",
  input: { value: "./vendor/bin/pint", language: "bash" },
  output: { value: "PASS", language: "text" },
  defaultCollapsed: true,
};

describe("ToolCallBlock", () => {
  it("keeps complete details closed initially and expands on click", () => {
    render(<ToolCallBlock view={baseView} />);

    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("Pint and commit B1")).toBeInTheDocument();
    expect(screen.queryByText("IN")).not.toBeInTheDocument();

    const summary = screen.getByRole("button", { name: /Bash/i });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(summary);

    expect(screen.getByText("IN")).toBeInTheDocument();
    expect(screen.getByText("OUT")).toBeInTheDocument();
    expect(screen.getByText("./vendor/bin/pint")).toBeInTheDocument();
    expect(screen.getByText("PASS")).toBeInTheDocument();
  });

  it.each(["running", "failed"] as const)(
    "keeps %s details closed and exposes status in the summary",
    (status) => {
      render(<ToolCallBlock view={{ ...baseView, status }} />);

      const summary = screen.getByRole("button", { name: new RegExp(status, "i") });
      expect(summary).toHaveAttribute("aria-expanded", "false");
      if (status === "running") {
        expect(summary).toHaveAttribute("aria-busy", "true");
      } else {
        expect(summary).not.toHaveAttribute("aria-busy");
      }
      expect(screen.queryByText("IN")).not.toBeInTheDocument();
    },
  );

  it("preserves an explicitly expanded view for non-assistant consumers", () => {
    render(<ToolCallBlock view={{ ...baseView, defaultCollapsed: false }} />);

    expect(screen.getByText("IN")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bash/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("does not render a dead toggle when the tool has no details", () => {
    render(
      <ToolCallBlock
        view={{
          ...baseView,
          input: null,
          output: null,
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: /Bash/i })).not.toBeInTheDocument();
    expect(screen.getByText("Bash").closest("[aria-expanded]")).toBeNull();
  });

  it("truncates long output and reveals it via show more", () => {
    const longOutput = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    render(<ToolCallBlock view={{ ...baseView, output: { value: longOutput, language: "text" } }} />);
    fireEvent.click(screen.getByRole("button", { name: /Bash/i }));
    expect(screen.queryByText(/line 39/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show more/i }));
    expect(screen.getByText(/line 39/)).toBeInTheDocument();
  });

  it("shows a failed badge for failed status", () => {
    render(<ToolCallBlock view={{ ...baseView, status: "failed" }} />);
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
    expect(screen.getByText(/failed/i)).toHaveClass("text-destructive");
  });
});
