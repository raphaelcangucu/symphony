import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KbEditor } from "@/components/kb/KbEditor";

const HEADINGS_MD =
  "# Title One\n\n## Section Two\n\n### Sub Three\n\n#### Deep Four\n\nbody text";

function renderEditor(markdown: string) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<KbEditor title="Doc" markdown={markdown} onSave={onSave} saving={false} />);
  return { onSave };
}

function openToc() {
  return screen.findByRole("button", { name: /contents/i }).then((toggle) => {
    fireEvent.click(toggle);
    return screen.findByRole("navigation", { name: /on this page/i });
  });
}

describe("KbTableOfContents", () => {
  it("lists H1, H2 and H3 headings in document order", async () => {
    renderEditor(HEADINGS_MD);
    const nav = await openToc();

    expect(within(nav).getByRole("button", { name: "Title One" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Section Two" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Sub Three" })).toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Deep Four" })).not.toBeInTheDocument();
  });

  it("marks entry depth so deeper headings can be indented", async () => {
    renderEditor(HEADINGS_MD);
    const nav = await openToc();

    expect(within(nav).getByRole("button", { name: "Title One" })).toHaveAttribute("data-level", "1");
    expect(within(nav).getByRole("button", { name: "Section Two" })).toHaveAttribute("data-level", "2");
    expect(within(nav).getByRole("button", { name: "Sub Three" })).toHaveAttribute("data-level", "3");
  });

  it("scrolls to the heading on click and keeps the panel open", async () => {
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
    renderEditor(HEADINGS_MD);
    const nav = await openToc();

    fireEvent.click(within(nav).getByRole("button", { name: "Section Two" }));

    expect(scrollSpy).toHaveBeenCalled();
    expect(screen.getByRole("navigation", { name: /on this page/i })).toBeInTheDocument();
    scrollSpy.mockRestore();
  });

  it("closes the panel on Escape", async () => {
    renderEditor(HEADINGS_MD);
    await openToc();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("navigation", { name: /on this page/i })).not.toBeInTheDocument(),
    );
  });

  it("hides the button when the document has no headings", async () => {
    renderEditor("just a paragraph with no headings at all");

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /contents/i })).not.toBeInTheDocument(),
    );
  });
});
