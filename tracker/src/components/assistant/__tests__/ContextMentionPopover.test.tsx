import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ContextMentionPopover } from "@/components/assistant/ContextMentionPopover";
import type { ResolvedMention } from "@/components/assistant/contextMentions";

const options: ResolvedMention[] = [
  { type: "issue", id: "DEMO-1", label: "Login bug" },
  { type: "file", id: "lib/log.ex" },
  { type: "pr", id: "42", label: "Add caching" },
];

describe("ContextMentionPopover", () => {
  it("renders grouped headings for each entity type", () => {
    render(<ContextMentionPopover open options={options} activeIndex={0} onSelect={vi.fn()} />);

    expect(screen.getByText("Issues")).toBeInTheDocument();
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("Pull requests")).toBeInTheDocument();
  });

  it("marks the active item by flat index", () => {
    render(<ContextMentionPopover open options={options} activeIndex={1} onSelect={vi.fn()} />);

    const active = document.querySelector("[data-active='true']");
    expect(active?.textContent).toContain("lib/log.ex");
  });

  it("calls onSelect with the entity ref on click", () => {
    const onSelect = vi.fn();
    render(<ContextMentionPopover open options={options} activeIndex={0} onSelect={onSelect} />);

    screen.getByText("Add caching").closest("button")!.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    );

    expect(onSelect).toHaveBeenCalledWith({ type: "pr", id: "42" });
  });

  it("renders nothing when closed or empty", () => {
    const { container, rerender } = render(
      <ContextMentionPopover open={false} options={options} activeIndex={0} onSelect={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();

    rerender(<ContextMentionPopover open options={[]} activeIndex={0} onSelect={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
