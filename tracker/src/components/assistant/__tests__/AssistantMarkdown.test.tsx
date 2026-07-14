import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AssistantMarkdown } from "@/components/assistant/AssistantMarkdown";

describe("AssistantMarkdown", () => {
  it("normalizes document links into buttons", async () => {
    const user = userEvent.setup();
    const onOpenDocumentPath = vi.fn();

    render(
      <AssistantMarkdown
        content="[Open plan](./docs/plan.md)"
        onOpenDocumentPath={onOpenDocumentPath}
      />,
    );

    const documentButton = screen.getByRole("button", { name: "Open plan" });
    expect(documentButton).toHaveClass(
      "font-medium",
      "text-primary",
      "underline",
      "underline-offset-2",
      "hover:text-primary/80",
    );

    await user.click(documentButton);

    expect(onOpenDocumentPath).toHaveBeenCalledOnce();
    expect(onOpenDocumentPath).toHaveBeenCalledWith("docs/plan.md");
  });

  it("preserves external links and opts into assistant-scoped typography", () => {
    const { container } = render(
      <AssistantMarkdown content="[External site](https://example.com/reference)" />,
    );

    expect(screen.getByRole("link", { name: "External site" })).toHaveAttribute(
      "href",
      "https://example.com/reference",
    );
    expect(screen.getByRole("link", { name: "External site" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "External site" })).toHaveAttribute(
      "rel",
      "noreferrer noopener",
    );
    expect(container.firstElementChild).toHaveClass(
      "markdown-body",
      "markdown-body--assistant",
    );
  });

  it("wraps assistant tables in a semantic horizontal scroller", () => {
    const { container } = render(
      <AssistantMarkdown content={"| Name | Value |\n| --- | --- |\n| Alpha | Beta |"} />,
    );

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.parentElement).toHaveClass("assistant-markdown-table");
  });
});
