import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StateMultiSelect } from "@/components/projects/config/StateMultiSelect";

describe("StateMultiSelect", () => {
  it("renders one toggle per available status and marks selected ones", () => {
    render(
      <StateMultiSelect
        label="Active states"
        available={["Todo", "In Progress", "Done"]}
        value={["In Progress"]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Todo", pressed: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "In Progress", pressed: true })).toBeInTheDocument();
  });

  it("adds a status on click and removes it on second click", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StateMultiSelect label="Active states" available={["Todo", "Done"]} value={[]} onChange={onChange} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Todo" }));
    expect(onChange).toHaveBeenLastCalledWith(["Todo"]);

    rerender(<StateMultiSelect label="Active states" available={["Todo", "Done"]} value={["Todo"]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Todo" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
