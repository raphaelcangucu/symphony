import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KbToolCard } from "@/components/agent-activity/typed-tools/KbToolCard";

describe("KbToolCard", () => {
  it("shows kb path and open action", () => {
    const onOpen = vi.fn();
    render(
      <KbToolCard
        presentation={{
          family: "kb",
          toolName: "kb_create_page",
          title: "Criou página",
          summary: "CDE-1180 design",
          status: "completed",
          badges: [{ kind: "ok", label: "criada" }],
          links: [],
          body: null,
          raw: null,
          meta: {},
          kbPath: "superpowers/specs/2026-07-16-cde-1180.md",
        }}
        onOpenKbPath={onOpen}
      />,
    );
    expect(screen.getByText(/superpowers\/specs/)).toBeTruthy();
    const openButton = screen.getByRole("button", { name: /open in kb/i });
    fireEvent.click(openButton);
    expect(onOpen).toHaveBeenCalledWith("superpowers/specs/2026-07-16-cde-1180.md");
  });
});
