import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssistantPanelHeader } from "@/components/assistant/AssistantPanelHeader";

const baseProps = {
  title: "Assistant",
  isPageMode: true,
  diffStats: null,
  agentKind: "codex" as const,
};

describe("AssistantPanelHeader model provenance", () => {
  it("shows the provider-confirmed model and effort", () => {
    render(
      <AssistantPanelHeader
        {...baseProps}
        modelProvenance={{
          requestedModel: "gpt-5.6-sol",
          requestedEffort: "low",
          resolvedModel: "gpt-5.6-sol",
          resolvedEffort: "low",
        }}
      />,
    );

    expect(screen.getByTestId("assistant-model-provenance")).toHaveTextContent(
      "Codex · gpt-5.6-sol · low",
    );
  });

  it("labels a requested model as pending until the provider confirms it", () => {
    render(
      <AssistantPanelHeader
        {...baseProps}
        agentKind="claude"
        modelProvenance={{
          requestedModel: "claude-sonnet-5",
          requestedEffort: "medium",
          resolvedModel: null,
          resolvedEffort: null,
        }}
      />,
    );

    expect(screen.getByTestId("assistant-model-provenance")).toHaveTextContent(
      "Claude · requested claude-sonnet-5 · awaiting confirmation",
    );
  });

  it("shows both values when the provider reroutes the request", () => {
    render(
      <AssistantPanelHeader
        {...baseProps}
        modelProvenance={{
          requestedModel: "gpt-5.6",
          requestedEffort: "medium",
          resolvedModel: "gpt-5.6-sol",
          resolvedEffort: "low",
        }}
      />,
    );

    expect(screen.getByTestId("assistant-model-provenance")).toHaveTextContent(
      "Codex · gpt-5.6-sol · low · rerouted from gpt-5.6 · medium",
    );
    expect(
      screen.getByTestId("assistant-model-provenance-details"),
    ).toHaveTextContent("Requestedgpt-5.6 · medium");
    expect(
      screen.getByTestId("assistant-model-provenance-details"),
    ).toHaveTextContent("Resolvedgpt-5.6-sol · low");
  });
});
