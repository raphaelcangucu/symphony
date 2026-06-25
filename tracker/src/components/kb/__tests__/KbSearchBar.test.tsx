import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as service from "@/services/knowledgeBase";
import { KbSearchBar } from "@/components/kb/KbSearchBar";

describe("KbSearchBar", () => {
  it("shows results and invokes onSelect", async () => {
    vi.spyOn(service, "searchProject").mockResolvedValue([
      { projectSlug: "acme", repoSlug: "web", path: "auth.md", title: "Auth", snippet: "secret", rank: 1 },
    ]);
    const onSelect = vi.fn();
    render(<KbSearchBar projectSlug="acme" onSelect={onSelect} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "auth" } });
    await waitFor(() => expect(screen.getByText("Auth")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Auth"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ path: "auth.md", repoSlug: "web" }));
  });
});
