import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModelMenu } from "@/components/assistant/ModelMenu";
import type { AssistantAgentCatalog } from "@/lib/assistantSettings";

function buildCatalog(modelCount: number): AssistantAgentCatalog {
  return {
    agent: "cursor",
    agentLabel: "Cursor Agent",
    command: "cursor-agent",
    defaultModel: "model-0",
    models: Array.from({ length: modelCount }, (_, index) => ({
      id: `model-${index}`,
      model: `model-${index}`,
      label: `Model ${index}`,
      isDefault: index === 0,
      defaultEffort: "",
      efforts: [],
      inputModalities: ["text"],
    })),
  };
}

describe("ModelMenu", () => {
  function openMenu() {
    fireEvent.pointerDown(screen.getByRole("button", { name: /model 0/i }));
  }

  it("keeps long model lists in a scrollable panel", () => {
    render(<ModelMenu catalog={buildCatalog(40)} model="model-0" onChange={vi.fn()} />);

    openMenu();

    const scroll = screen.getByTestId("model-menu-scroll");
    expect(scroll.className).toContain("overflow-auto");
    expect(scroll.className).toContain("max-h-60");
    expect(screen.getByRole("menuitemradio", { name: "Model 39" })).toBeTruthy();
  });

  it("filters models from the search field", () => {
    render(<ModelMenu catalog={buildCatalog(5)} model="model-0" onChange={vi.fn()} />);

    openMenu();
    fireEvent.change(screen.getByPlaceholderText(/search models/i), { target: { value: "Model 3" } });

    expect(screen.getByRole("menuitemradio", { name: "Model 3" })).toBeTruthy();
    expect(screen.queryByRole("menuitemradio", { name: "Model 0" })).toBeNull();
  });

  it("marks the catalog default model with a star", () => {
    render(<ModelMenu catalog={buildCatalog(3)} model="model-0" onChange={vi.fn()} />);

    openMenu();

    const stars = screen.getAllByTestId("model-default-star");
    expect(stars).toHaveLength(1);
  });
});
