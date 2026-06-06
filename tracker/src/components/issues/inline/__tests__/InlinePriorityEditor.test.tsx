import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InlinePriorityEditor } from "../InlinePriorityEditor";

describe("InlinePriorityEditor", () => {
  it("renders the current priority label", () => {
    render(<InlinePriorityEditor priority={1} onSave={async () => true} />);
    expect(screen.getByRole("button", { name: /urgent/i })).toBeInTheDocument();
  });

  it("renders without a loop for a no-priority issue", () => {
    render(<InlinePriorityEditor priority={null} onSave={async () => true} />);
    expect(screen.getByRole("button", { name: /no priority/i })).toBeInTheDocument();
  });

  it("opens the popover and saves the chosen priority", async () => {
    const onSave = vi.fn(async () => true);
    const user = userEvent.setup();
    render(<InlinePriorityEditor priority={null} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /no priority/i }));
    await user.click(await screen.findByRole("button", { name: /^high$/i }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(onSave).toHaveBeenCalledWith(2);
  });
});
