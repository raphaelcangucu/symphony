import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectAgentSelect } from "@/components/projects/ProjectAgentSelect";

describe("ProjectAgentSelect", () => {
  it("shows Inherit with the effective agent and fires null", () => {
    const onChange = vi.fn();
    render(<ProjectAgentSelect value="claude" effectiveDefault="codex" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Inherit \(Codex\)/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("fires the explicit kind", () => {
    const onChange = vi.fn();
    render(<ProjectAgentSelect value={null} effectiveDefault="codex" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Claude Code" }));
    expect(onChange).toHaveBeenCalledWith("claude");
  });
});
