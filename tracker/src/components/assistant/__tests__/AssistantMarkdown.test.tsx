import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AssistantMarkdown } from "@/components/assistant/AssistantMarkdown";
import { AssistantKbDocumentLinksProvider } from "@/components/assistant/assistantKbDocumentLinksContext";
import type { KbDocumentLinkTarget } from "@/lib/kbDocumentLinks";

describe("AssistantMarkdown", () => {
  it("normalizes document links into buttons without a KB index", async () => {
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

  it("linkifies existing KB paths and opens via the KB document href", async () => {
    const user = userEvent.setup();
    const openDocument = vi.fn();
    const target: KbDocumentLinkTarget = {
      path: "market/spec.md",
      repoSlug: "back",
      href: "/projects/macro-markets/kb/back/market/spec.md",
    };

    render(
      <AssistantKbDocumentLinksProvider
        value={{
          resolve: (raw) => (raw.includes("market/spec.md") ? target : null),
          openDocument,
        }}
      >
        <AssistantMarkdown content="See docs/market/spec.md and docs/market/missing.md" />
      </AssistantKbDocumentLinksProvider>,
    );

    const link = screen.getByRole("link", { name: "docs/market/spec.md" });
    expect(link).toHaveAttribute("href", target.href);
    expect(screen.getByText(/docs\/market\/missing\.md/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "docs/market/missing.md" })).not.toBeInTheDocument();

    await user.click(link);
    expect(openDocument).toHaveBeenCalledWith("market/spec.md");
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
