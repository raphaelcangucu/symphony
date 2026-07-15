import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

  const truncatedView: ToolCallView = {
    ...baseView,
    output: { value: "preview…", language: "text" },
    outputTruncated: true,
    outputByteSize: 1_048_576,
  };

  it("does not offer a full-output control when the output is not truncated", () => {
    render(<ToolCallBlock view={baseView} toolCallId="call-1" onLoadFullOutput={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Bash/i }));
    expect(screen.queryByRole("button", { name: /load full output/i })).not.toBeInTheDocument();
  });

  it("does not offer a full-output control without a handler or tool-call id", () => {
    const { rerender } = render(<ToolCallBlock view={truncatedView} toolCallId="call-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Bash/i }));
    expect(screen.queryByRole("button", { name: /load full output/i })).not.toBeInTheDocument();

    rerender(<ToolCallBlock view={truncatedView} toolCallId="  " onLoadFullOutput={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /load full output/i })).not.toBeInTheDocument();
  });

  it("fetches and reveals the full output when the control is clicked", async () => {
    const onLoadFullOutput = vi.fn().mockResolvedValue("FULL OUTPUT BODY");
    render(<ToolCallBlock view={truncatedView} toolCallId="call-1" onLoadFullOutput={onLoadFullOutput} />);
    fireEvent.click(screen.getByRole("button", { name: /Bash/i }));

    const loadButton = screen.getByRole("button", { name: /load full output \(1\.0 MB\)/i });
    fireEvent.click(loadButton);

    expect(onLoadFullOutput).toHaveBeenCalledWith("call-1");
    expect(await screen.findByText("FULL OUTPUT BODY")).toBeInTheDocument();
    expect(screen.queryByText("preview…")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load full output/i })).not.toBeInTheDocument();
  });

  it("surfaces an error and keeps the control when the fetch fails", async () => {
    const onLoadFullOutput = vi.fn().mockRejectedValue(new Error("not found"));
    render(<ToolCallBlock view={truncatedView} toolCallId="call-1" onLoadFullOutput={onLoadFullOutput} />);
    fireEvent.click(screen.getByRole("button", { name: /Bash/i }));

    fireEvent.click(screen.getByRole("button", { name: /load full output/i }));

    expect(await screen.findByText(/could not load the full output/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /load full output/i })).not.toBeDisabled(),
    );
  });
});
