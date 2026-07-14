import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KbEditor } from "@/components/kb/KbEditor";
import { copyTextToClipboard } from "@/lib/clipboard";

vi.mock("@/lib/clipboard", () => ({
  copyTextToClipboard: vi.fn(),
}));

// Mermaid is heavy and needs real layout to render; mock the helper so the node
// view's wiring (toggle + preview injection) can be asserted deterministically.
vi.mock("@/lib/mermaid", () => ({
  detectMermaidTheme: () => "light",
  renderMermaid: vi.fn().mockResolvedValue({
    status: "ok",
    svg: '<svg data-testid="mermaid-svg"></svg>',
  }),
}));

describe("KbEditor", () => {
  it("renders the page title and saves markdown", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<KbEditor title="Backend" markdown={"# Backend\n\nbody"} onSave={onSave} saving={false} />);

    expect(screen.getByTestId("kb-editor-title")).toHaveTextContent("Backend");

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(typeof onSave.mock.calls[0]?.[0]).toBe("string");
  });

  it("force-saves on Ctrl+S and prevents the browser save dialog", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<KbEditor title="Backend" markdown={"# Backend\n\nbody"} onSave={onSave} saving={false} />);

    const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true });
    const prevented = !window.dispatchEvent(event);

    expect(prevented).toBe(true);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(typeof onSave.mock.calls[0]?.[0]).toBe("string");
  });

  it("copies the GitHub file link from the title bar", async () => {
    vi.mocked(copyTextToClipboard).mockResolvedValue(true);
    render(
      <KbEditor
        title="Vibe"
        markdown={"# Vibe\n\nbody"}
        onSave={vi.fn()}
        saving={false}
        githubFileUrl="https://github.com/civitaslearning/advising/blob/main/docs/VIBE.md"
      />,
    );

    fireEvent.click(screen.getByTestId("kb-copy-github-link"));
    await waitFor(() =>
      expect(copyTextToClipboard).toHaveBeenCalledWith(
        "https://github.com/civitaslearning/advising/blob/main/docs/VIBE.md",
      ),
    );
  });

  it("renders a mermaid code block as a live diagram with a source toggle", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const markdown = ["# Architecture", "", "```mermaid", "flowchart TD", "  A --> B", "```"].join("\n");
    render(<KbEditor title="Architecture" markdown={markdown} onSave={onSave} saving={false} />);

    // The mermaid node view replaces the raw code block with a Preview/Code toggle.
    expect(await screen.findByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Code" })).toBeInTheDocument();

    // The diagram SVG is injected into the preview surface.
    await waitFor(() => expect(document.querySelector(".kb-mermaid-diagram svg")).toBeTruthy());

    // Switching to Code reveals the editable source block.
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(document.querySelector("pre.kb-mermaid-source")).toBeTruthy();
  });
});
