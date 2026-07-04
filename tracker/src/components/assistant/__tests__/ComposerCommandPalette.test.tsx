import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComposerCommandPalette } from "@/components/assistant/ComposerCommandPalette";
import type { SlashCommandDef } from "@/components/assistant/slashCommands";
import { initTestI18n } from "@/i18n/testUtils";

const commands: SlashCommandDef[] = [
  { name: "/goal", kind: "goal", description: "Set the goal", category: "builtin" },
  {
    name: "/push",
    kind: "message",
    description: "Push the branch",
    category: "workflow",
    insertText: "Use the push skill: ",
  },
  {
    name: "/brainstorm",
    kind: "message",
    description: "Explore ideas",
    category: "superpowers",
    insertText: "Use the brainstorm skill: ",
  },
  { name: "/legacy", kind: "message", description: "Uncategorized command", category: null },
];

describe("ComposerCommandPalette", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("groups commands by category heading", () => {
    render(
      <ComposerCommandPalette open onOpenChange={vi.fn()} commands={commands} onSelect={vi.fn()} />,
    );

    expect(screen.getByText("Compose", { selector: "[cmdk-group-heading]" })).toBeInTheDocument();
    expect(screen.getByText("Workflow", { selector: "[cmdk-group-heading]" })).toBeInTheDocument();
    expect(screen.getByText("Superpowers", { selector: "[cmdk-group-heading]" })).toBeInTheDocument();
    expect(screen.getByText("Uncategorized", { selector: "[cmdk-group-heading]" })).toBeInTheDocument();
    expect(screen.getByText("/push")).toBeInTheDocument();
  });

  it("filters by search and returns the selected command", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ComposerCommandPalette
        open
        onOpenChange={onOpenChange}
        commands={commands}
        onSelect={onSelect}
      />,
    );

    await user.type(screen.getByPlaceholderText("Search magic commands…"), "/push");

    await waitFor(() => {
      const options = screen.getAllByRole("option");
      expect(options[0]).toHaveTextContent("/push");
    });

    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: "/push" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <ComposerCommandPalette
        open
        onOpenChange={onOpenChange}
        commands={commands}
        onSelect={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
