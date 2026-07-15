import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantSessionErrorBoundary } from "@/components/assistant/AssistantSessionErrorBoundary";

function Boom({ shouldThrow }: { shouldThrow: boolean }): ReactElement {
  if (shouldThrow) throw new Error("malformed tool block");
  return <div>transcript ok</div>;
}

describe("AssistantSessionErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when nothing throws", () => {
    render(
      <AssistantSessionErrorBoundary title="t" description="d" retryLabel="retry">
        <div>healthy</div>
      </AssistantSessionErrorBoundary>,
    );

    expect(screen.getByText("healthy")).toBeInTheDocument();
  });

  it("shows the fallback with a retry action when a child throws", () => {
    render(
      <AssistantSessionErrorBoundary
        title="Rendering error"
        description="Navigation still works."
        retryLabel="Reload conversation"
      >
        <Boom shouldThrow />
      </AssistantSessionErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Rendering error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload conversation" })).toBeInTheDocument();
  });

  it("recovers and calls onReset when retry is clicked", () => {
    const onReset = vi.fn();
    let throwing = true;

    function Harness(): ReactElement {
      return (
        <AssistantSessionErrorBoundary
          title="Rendering error"
          description="d"
          retryLabel="Reload conversation"
          onReset={onReset}
        >
          <Boom shouldThrow={throwing} />
        </AssistantSessionErrorBoundary>
      );
    }

    const { rerender } = render(<Harness />);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Feed non-throwing children (as a parent onReset would) before clearing the
    // error, then retry to remount the healthy subtree.
    throwing = false;
    rerender(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Reload conversation" }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText("transcript ok")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
