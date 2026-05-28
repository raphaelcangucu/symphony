import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SaveAsTemplateDialog } from "@/components/templates/SaveAsTemplateDialog";
import * as templates from "@/services/templates";

vi.mock("@/services/templates");

describe("SaveAsTemplateDialog", () => {
  it("submits and reports saved template", async () => {
    vi.mocked(templates.saveProjectAsTemplate).mockResolvedValue({ slug: "p-tpl" } as never);
    const onSaved = vi.fn();
    render(<SaveAsTemplateDialog projectSlug="p" onSaved={onSaved} />);

    await userEvent.click(screen.getByRole("button", { name: /save as template/i }));
    await userEvent.type(screen.getByPlaceholderText(/template-slug/i), "p-tpl");
    await userEvent.click(screen.getByRole("button", { name: /^save template$/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(templates.saveProjectAsTemplate).toHaveBeenCalledWith("p", expect.objectContaining({ slug: "p-tpl" }));
  });
});
