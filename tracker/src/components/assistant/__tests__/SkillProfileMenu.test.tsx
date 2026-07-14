import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SkillProfileMenu } from "@/components/assistant/SkillProfileMenu";

describe("SkillProfileMenu", () => {
  it("shows Auto alongside the resolved toolkit", async () => {
    const user = userEvent.setup();
    render(
      <SkillProfileMenu
        selection="auto"
        resolvedProfile="planning"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("skill-profile-menu")).toHaveTextContent(/Planning/i);
    expect(screen.getByTestId("skill-profile-menu")).toHaveTextContent(/Auto/i);
    expect(screen.queryByTestId("skill-profile-active-chips")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("skill-profile-menu"));
    const activeChips = await screen.findByTestId("skill-profile-active-chips");
    expect(activeChips).toHaveTextContent(/Brainstorming/i);
    expect(activeChips).toHaveTextContent(/Writing Plans/i);
  });

  it("reports a pinned profile selection", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SkillProfileMenu
        selection="auto"
        resolvedProfile="implementation"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByTestId("skill-profile-menu"));
    await user.click(screen.getByRole("menuitemradio", { name: /Debugging/i }));
    expect(onChange).toHaveBeenCalledWith("debugging");
  });

  it("labels a non-auto selection as Custom", () => {
    render(
      <SkillProfileMenu
        selection="debugging"
        resolvedProfile="debugging"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("skill-profile-menu")).toHaveTextContent(/Custom/i);
  });
});
