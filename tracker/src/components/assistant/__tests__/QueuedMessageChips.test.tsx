import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QueuedMessageChips } from "@/components/assistant/QueuedMessageChips";

describe("QueuedMessageChips", () => {
  it("calls onEdit when the edit button is clicked", () => {
    const onEdit = vi.fn();
    const onSendNow = vi.fn();
    const onRemove = vi.fn();

    render(
      <QueuedMessageChips
        items={[{ id: "q-1", message: "rewrite this later" }]}
        onSendNow={onSendNow}
        onEdit={onEdit}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /edit queued message/i }));

    expect(onEdit).toHaveBeenCalledWith("q-1");
    expect(onSendNow).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });
});
