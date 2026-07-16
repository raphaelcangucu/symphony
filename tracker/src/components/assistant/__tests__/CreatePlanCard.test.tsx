import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CreatePlanCard } from "../CreatePlanCard";

describe("CreatePlanCard", () => {
  it("submits accept and reject without treating open KB as resolve", async () => {
    const onSubmit = vi.fn();
    const onOpenKbPath = vi.fn();
    const user = userEvent.setup();

    render(
      <CreatePlanCard
        request={{
          requestId: "plan-1",
          name: "GAM-20 Spec",
          overview: "Tighten layout",
          plan: "See [spec](docs/superpowers/specs/example.md)",
          planUri: null,
        }}
        onSubmit={onSubmit}
        onOpenKbPath={onOpenKbPath}
      />,
    );

    await user.click(screen.getByRole("button", { name: /open in knowledge base/i }));
    expect(onOpenKbPath).toHaveBeenCalledWith("docs/superpowers/specs/example.md");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /accept/i }));
    expect(onSubmit).toHaveBeenCalledWith("plan-1", "accept");
  });
});
