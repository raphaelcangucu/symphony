import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BtwOverlay } from "../BtwOverlay";

describe("BtwOverlay", () => {
  it("renders the question and streamed answer", () => {
    render(<BtwOverlay question="what is x?" answer="x is 1" status="streaming" onClose={vi.fn()} />);
    expect(screen.getByText("what is x?")).toBeInTheDocument();
    expect(screen.getByText("x is 1")).toBeInTheDocument();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<BtwOverlay question="q" answer="" status="streaming" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an error message when status is error", () => {
    render(<BtwOverlay question="q" answer="boom" status="error" onClose={vi.fn()} />);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
});
