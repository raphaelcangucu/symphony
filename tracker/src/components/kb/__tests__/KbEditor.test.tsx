import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KbEditor } from "@/components/kb/KbEditor";

describe("KbEditor", () => {
  it("renders the page title and saves markdown", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<KbEditor title="Backend" markdown={"# Backend\n\nbody"} onSave={onSave} saving={false} />);

    expect(screen.getByTestId("kb-editor-title")).toHaveTextContent("Backend");

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(typeof onSave.mock.calls[0]?.[0]).toBe("string");
  });
});
