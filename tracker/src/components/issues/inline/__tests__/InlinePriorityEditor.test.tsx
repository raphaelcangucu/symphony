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

  it("autosaves the chosen priority when clicking outside", async () => {
    const onSave = vi.fn(async () => true);
    const user = userEvent.setup();
    render(
      <>
        <InlinePriorityEditor priority={null} onSave={onSave} />
        <button type="button">Outside</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: /no priority/i }));
    await user.click(await screen.findByRole("button", { name: /^high$/i }));
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^close$/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^outside$/i }));

    expect(onSave).toHaveBeenCalledWith(2);
  });
});
