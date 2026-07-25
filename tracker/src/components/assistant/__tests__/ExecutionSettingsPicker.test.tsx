import { fireEvent, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ExecutionSettingsPicker } from "@/components/assistant/ExecutionSettingsPicker";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import { createMockAssistantCatalogBundle } from "@/test-fixtures/assistantCatalog";
import { mockAssistantCodexCatalog } from "@/test-fixtures/assistantCatalog";
import { i18n } from "@/i18n";

const bundle = createMockAssistantCatalogBundle();
bundle.agents = [
  { ...mockAssistantCodexCatalog },
  ...bundle.agents.filter((agent) => agent.agent !== "codex"),
];

const inheritLabel = "Inherit (Codex)";

describe("ExecutionSettingsPicker", () => {
  beforeAll(async () => {
    await initTestI18n("en");
  });

  it("calls onAgentChange(null) when inherit is selected", () => {
    const onAgentChange = vi.fn();

    renderWithI18n(
      <ExecutionSettingsPicker
        bundle={bundle}
        agent="codex"
        model="gpt-5.3-codex"
        effort="low"
        allowInherit
        inheritAgentLabel={inheritLabel}
        onAgentChange={onAgentChange}
        onModelChange={vi.fn()}
        onEffortChange={vi.fn()}
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: i18n.t("issue.sessionLog.agentLabels.codex") }),
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: inheritLabel }));

    expect(onAgentChange).toHaveBeenCalledWith(null);
  });

  it("hides inherit option when allowInherit is false", () => {
    renderWithI18n(
      <ExecutionSettingsPicker
        bundle={bundle}
        agent="codex"
        model="gpt-5.3-codex"
        effort="low"
        allowInherit={false}
        inheritAgentLabel={inheritLabel}
        onAgentChange={vi.fn()}
        onModelChange={vi.fn()}
        onEffortChange={vi.fn()}
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: i18n.t("issue.sessionLog.agentLabels.codex") }),
    );

    expect(screen.queryByRole("menuitemradio", { name: inheritLabel })).toBeNull();
    expect(screen.getByRole("menuitemradio", { name: i18n.t("issue.sessionLog.agentLabels.codex") })).toBeTruthy();
  });
});
