import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoadDefaultMenu } from "@/components/projects/LoadDefaultMenu";
import * as templates from "@/services/templates";

describe("LoadDefaultMenu", () => {
  it("loads the selected template into the form", async () => {
    vi.spyOn(templates, "listTemplates").mockResolvedValue([
      { slug: "macro-markets", name: "Macro Markets", promptTemplate: "PROMPT", afterCreateHook: "HOOK", validationCommands: ["npm test"], repositories: [], description: null },
    ] as never);
    const onLoad = vi.fn();
    render(<LoadDefaultMenu onLoad={onLoad} />);
    fireEvent.click(await screen.findByRole("button", { name: /load default/i }));
    fireEvent.click(await screen.findByText("Macro Markets"));
    await waitFor(() => expect(onLoad).toHaveBeenCalledWith(expect.objectContaining({ promptTemplate: "PROMPT" })));
  });
});
