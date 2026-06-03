import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolCallBlock, type ToolCallView } from "@/components/shared/ToolCallBlock";

const baseView: ToolCallView = {
  toolType: "Bash",
  description: "Pint and commit B1",
  status: "completed",
  input: { value: "./vendor/bin/pint", language: "bash" },
  output: { value: "PASS", language: "text" },
  defaultCollapsed: false,
};

describe("ToolCallBlock", () => {
  it("renders header, IN and OUT when expanded", () => {
    render(<ToolCallBlock view={baseView} />);
    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("Pint and commit B1")).toBeInTheDocument();
    expect(screen.getByText("IN")).toBeInTheDocument();
    expect(screen.getByText("OUT")).toBeInTheDocument();
    expect(screen.getByText("./vendor/bin/pint")).toBeInTheDocument();
    expect(screen.getByText("PASS")).toBeInTheDocument();
  });

  it("starts collapsed when defaultCollapsed is true and expands on click", () => {
    render(<ToolCallBlock view={{ ...baseView, defaultCollapsed: true }} />);
    expect(screen.queryByText("IN")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Bash/i }));
    expect(screen.getByText("IN")).toBeInTheDocument();
  });

  it("truncates long output and reveals it via show more", () => {
    const longOutput = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    render(<ToolCallBlock view={{ ...baseView, output: { value: longOutput, language: "text" } }} />);
    expect(screen.queryByText(/line 39/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show more/i }));
    expect(screen.getByText(/line 39/)).toBeInTheDocument();
  });

  it("shows a failed badge for failed status", () => {
    render(<ToolCallBlock view={{ ...baseView, status: "failed" }} />);
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });
});
