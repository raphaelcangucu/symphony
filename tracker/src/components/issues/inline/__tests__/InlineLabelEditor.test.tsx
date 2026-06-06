import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InlineLabelEditor } from "../InlineLabelEditor";
import type { IssueLabelOption } from "@/types/issue";

const options: IssueLabelOption[] = [
  { id: "LA_kwDOJHngx88AAAACmEYycw", name: "bug", color: "ff0000" },
  { id: "L2", name: "frontend", color: null },
];

describe("InlineLabelEditor", () => {
  // Regression: the sync effect used to depend on `userVisibleLabels(labels)`,
  // a fresh array every render, so it called setDraft on every render and looped
  // until React threw "Maximum update depth exceeded" (freezing the Summary tab).
  // Rendering at all is the guard — an infinite loop would hang/throw here.
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

  it("hides symphony:* system labels", () => {
    render(
      <InlineLabelEditor labels={["bug", "symphony:codex"]} options={options} onSave={async () => true} />,
    );
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.queryByText("symphony:codex")).not.toBeInTheDocument();
  });

  it("opens the popover and saves the selected labels", async () => {
    const onSave = vi.fn(async () => true);
    const user = userEvent.setup();
    render(<InlineLabelEditor labels={["bug"]} options={options} onSave={onSave} />);

    await user.click(screen.getByRole("button"));
    await user.click(await screen.findByRole("button", { name: /^frontend$/i }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    // Existing labels keep their stored value; toggled catalog options use the option id.
    expect(onSave).toHaveBeenCalledWith(["bug", "L2"]);
  });
});
