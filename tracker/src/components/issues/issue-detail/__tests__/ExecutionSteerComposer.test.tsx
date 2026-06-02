import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExecutionSteerComposer } from "@/components/issues/issue-detail/ExecutionSteerComposer";

describe("ExecutionSteerComposer", () => {
  it("submits /infer messages to onSteer", () => {
    const onSteer = vi.fn();
    render(<ExecutionSteerComposer onSteer={onSteer} />);

    fireEvent.change(screen.getByPlaceholderText(/focus on the failing test/i), {
      target: { value: "/infer prefer the simpler fix" },
    });
    fireEvent.click(screen.getByRole("button", { name: /steer/i }));

    expect(onSteer).toHaveBeenCalledWith("prefer the simpler fix");
  });

  it("shows a friendly error for ActiveTurnNotSteerable", () => {
    render(<ExecutionSteerComposer onSteer={vi.fn()} error="ActiveTurnNotSteerable" />);
    expect(screen.getByText(/no steerable agent turn/i)).toBeInTheDocument();
  });
});
