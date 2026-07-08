import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { AssistantTasksToolbarToggle } from "@/components/agent-activity/AssistantTasksToolbarToggle";

describe("AssistantTasksToolbarToggle", () => {
  it("renders nothing when there is no control", () => {
    const { container } = render(<AssistantTasksToolbarToggle control={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the completion progress and toggles on click", () => {
    const toggle = vi.fn();
    render(<AssistantTasksToolbarToggle control={{ done: 1, total: 2, open: true, toggle }} />);

    const button = screen.getByRole("button", { name: "Hide tasks panel" });
    expect(button).toHaveTextContent("1/2 done");
    expect(button).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("labels the button to show the panel when collapsed", () => {
    render(<AssistantTasksToolbarToggle control={{ done: 0, total: 3, open: false, toggle: () => {} }} />);

    const button = screen.getByRole("button", { name: "Show tasks panel" });
    expect(button).toHaveAttribute("aria-pressed", "false");
  });
});
