import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InlineLabelEditor } from "../InlineLabelEditor";
import type { IssueLabelOption } from "@/types/issue";

const options: IssueLabelOption[] = [
  { id: "LA_kwDOJHngx88AAAACmEYycw", name: "bug", color: "ff0000" },
  { id: "L2", name: "frontend", color: null },
  { id: "L3", name: "symphony:codex", color: null },
  { id: "L4", name: "symphony", color: null },
];

describe("InlineLabelEditor", () => {
  // Regression: the sync effect used to depend on filtered label arrays,
  // a fresh array each render, so it called setDraft on every render and looped.
  it("renders without an update-depth loop", () => {
    render(<InlineLabelEditor labels={["bug"]} options={options} onSave={async () => true} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
    expect(screen.getByText("bug")).toBeInTheDocument();
  });

  it("shows the add-labels affordance when there are no user labels", () => {
    render(<InlineLabelEditor labels={[]} options={options} onSave={async () => true} />);
    expect(screen.getByRole("button", { name: /add labels/i })).toBeInTheDocument();
  });

  it("shows the label name instead of the remote id", () => {
    render(
      <InlineLabelEditor
        labels={["LA_kwDOJHngx88AAAACmEYycw"]}
        options={options}
        onSave={async () => true}
      />,
    );
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.queryByText("LA_kwDOJHngx88AAAACmEYycw")).not.toBeInTheDocument();
  });

  it("shows symphony labels in the editor trigger and popover", () => {
    render(
      <InlineLabelEditor labels={["bug", "symphony:codex"]} options={options} onSave={async () => true} />,
    );
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByText("symphony:codex")).toBeInTheDocument();
  });

  it("opens the popover and saves the selected labels", async () => {
    const onSave = vi.fn(async () => true);
    const user = userEvent.setup();
    render(<InlineLabelEditor labels={["bug"]} options={options} onSave={onSave} />);

    await user.click(screen.getByRole("button"));
    await user.click(await screen.findByRole("button", { name: /^frontend$/i }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    // Save canonical GitHub label ids so the API can resolve and push them reliably.
    expect(onSave).toHaveBeenCalledWith(["LA_kwDOJHngx88AAAACmEYycw", "L2"]);
  });

  it("lists symphony labels first and filters by search", async () => {
    const user = userEvent.setup();
    render(<InlineLabelEditor labels={[]} options={options} onSave={async () => true} />);

    await user.click(screen.getByRole("button", { name: /add labels/i }));
    const labelButtons = await screen.findAllByRole("button", { pressed: false });
    const symphonyButtons = labelButtons.filter((button) => button.textContent?.includes("symphony"));
    expect(symphonyButtons[0]?.textContent).toMatch(/^symphony$/);
    expect(symphonyButtons[1]?.textContent).toMatch(/symphony:codex/);

    await user.type(screen.getByRole("textbox", { name: /search labels/i }), "cod");
    expect(screen.getByRole("button", { name: /^symphony:codex$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^bug$/i })).not.toBeInTheDocument();
  });
});
