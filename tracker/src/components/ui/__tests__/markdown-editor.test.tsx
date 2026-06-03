import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "@/components/ui/markdown-editor";

describe("MarkdownEditor", () => {
  it("edits in Write and renders in Preview", () => {
    const onChange = vi.fn();
    render(<MarkdownEditor value="# Hello" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "# Hi" } });
    expect(onChange).toHaveBeenCalledWith("# Hi");
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
  });
});
