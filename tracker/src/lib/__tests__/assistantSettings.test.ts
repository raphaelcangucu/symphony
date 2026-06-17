import { describe, expect, it } from "vitest";

import {
  catalogAgentLabel,
  catalogFor,
  fallbackCatalogBundle,
  loadComposerState,
  saveComposerState,
} from "@/lib/assistantSettings";

describe("composer state v2", () => {
  it("defaults to the bundle's default agent with that catalog's default model", () => {
    window.localStorage.clear();
    const bundle = fallbackCatalogBundle();
    const state = loadComposerState(bundle);

    expect(state.agent).toBe("codex");
    expect(state.byAgent.codex?.model ?? catalogFor(bundle, "codex").defaultModel).toBeTruthy();
  });

  it("persists per-agent model choices independently", () => {
    window.localStorage.clear();
    const bundle = fallbackCatalogBundle();
    const state = loadComposerState(bundle);

    state.agent = "claude";
    state.byAgent.claude = { model: "claude-sonnet-4-6", effort: "" };
    saveComposerState(state);

    const reloaded = loadComposerState(bundle);
    expect(reloaded.agent).toBe("claude");
    expect(reloaded.byAgent.claude?.model).toBe("claude-sonnet-4-6");
    expect(catalogFor(bundle, "claude").agentLabel).toBe(catalogAgentLabel("claude"));
  });
});
