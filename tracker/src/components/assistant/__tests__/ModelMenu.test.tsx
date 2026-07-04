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

  it("groups cursor model variants by base model name", () => {
    const onChange = vi.fn();
    const catalog: AssistantAgentCatalog = {
      agent: "cursor",
      agentLabel: "Cursor Agent",
      command: "cursor-agent",
      defaultModel: "auto",
      models: [
        { id: "auto", model: "auto", label: "Auto", isDefault: true, defaultEffort: "", efforts: [] },
        { id: "gpt-5.3-codex-low", model: "gpt-5.3-codex-low", label: "Codex 5.3 Low", isDefault: false, defaultEffort: "", efforts: [] },
        { id: "gpt-5.3-codex-high", model: "gpt-5.3-codex-high", label: "Codex 5.3 High", isDefault: false, defaultEffort: "", efforts: [] },
        { id: "gpt-5.2-codex-low", model: "gpt-5.2-codex-low", label: "Codex 5.2 Low", isDefault: false, defaultEffort: "", efforts: [] },
        { id: "claude-opus-4-8-low", model: "claude-opus-4-8-low", label: "Opus 4.8 Low", isDefault: false, defaultEffort: "", efforts: [] },
      ],
    };

    render(<ModelMenu catalog={catalog} model="gpt-5.3-codex-high" onChange={onChange} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: /codex 5\.3/i }));

    expect(screen.getByRole("menuitemradio", { name: "Codex 5.3" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "Codex 5.2" })).toBeTruthy();
    expect(screen.queryByRole("menuitemradio", { name: "Codex 5.3 Low" })).toBeNull();

    const labels = screen.getAllByRole("menuitemradio").map((item) => item.textContent?.trim());
    expect(labels).toEqual(["Auto", "Codex 5.2", "Codex 5.3", "Opus 4.8"]);

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Codex 5.2" }));
    expect(onChange).toHaveBeenCalledWith("gpt-5.2-codex-low");
  });
});
